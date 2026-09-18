import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS } from './mobile-native-chat-send'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import {
  sendMobileNativeChatPermissionResponse,
  useMobileNativeChatPermissionSend
} from './mobile-native-chat-permission-send'
import {
  isMobileNativeChatInputStale,
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'

describe('sendMobileNativeChatPermissionResponse', () => {
  it('rejects a changed Claude command even when its choices are identical', async () => {
    const screen = [
      'Bash command',
      ' echo first',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
      'Esc to cancel · Tab to amend'
    ]
    const sendRequest = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        result: {
          terminal: { lines: screen.map((line) => line.replace('echo first', 'echo different')) }
        }
      })
    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: null,
        text: '1',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: claudePermissionFromScreen(screen)
      })
    ).resolves.toBe('rejected')
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.read')
  })
  it('writes an approval as raw bytes without appending Return', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
    })

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '1'
      })
    ).resolves.toBe('accepted')
    expect(sendRequest).toHaveBeenCalledWith(
      'terminal.send',
      {
        terminal: 'terminal',
        text: '1',
        enter: false,
        client: { id: 'phone', type: 'mobile' }
      },
      { timeoutMs: MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS, budgetSpansConnect: true }
    )
  })

  it('surfaces an ambiguous delivery as unknown instead of a definite failure', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValue(markRpcDeliveryUnknown(new Error('Connection closed')))

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: null,
        text: '1'
      })
    ).resolves.toBe('unknown')
  })
})

describe('useMobileNativeChatPermissionSend', () => {
  let renderer: ReactTestRenderer | null = null
  let respond: ((text: string) => Promise<boolean>) | null = null

  beforeEach(() => {
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    respond = null
  })

  it('keeps the marker for a permission choice, which never submits the composer', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
    })
    function Harness(): null {
      respond = useMobileNativeChatPermissionSend({
        client: { sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError: vi.fn()
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    markMobileNativeChatInputStale('terminal')

    await act(async () => {
      await expect(respond?.('1')).resolves.toBe(true)
    })
    // A choice is a bare key for a live overlay that swallows a clear while the
    // host still acks it, so healing here would burn the marker and leave the
    // paste to corrupt the next real message. Only the choice may go.
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[1]).toMatchObject({ text: '1', enter: false })
    expect(isMobileNativeChatInputStale('terminal')).toBe(true)
  })

  it('rejects a choice while another composed write holds the terminal, then recovers', async () => {
    const onSendError = vi.fn()
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
    })
    function Harness(): null {
      respond = useMobileNativeChatPermissionSend({
        client: { sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })

    // An image paste sequence is mid-flight into the same PTY: the choice
    // keystroke must not interleave into it.
    expect(acquireMobileNativeChatTerminalWrite('terminal')).toBe(true)
    await act(async () => {
      await expect(respond?.('1')).resolves.toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Response not sent')

    releaseMobileNativeChatTerminalWrite('terminal')
    await act(async () => {
      await expect(respond?.('1')).resolves.toBe(true)
    })
    // The choice released its own hold on the way out.
    expect(acquireMobileNativeChatTerminalWrite('terminal')).toBe(true)
    releaseMobileNativeChatTerminalWrite('terminal')
  })

  it('tells the user what the terminal is waiting for instead of a dead "not sent"', async () => {
    const onSendError = vi.fn()
    const onResponseAccepted = vi.fn()
    const sendRequest = vi
      .fn()
      .mockResolvedValue(screenReply(PLAN_REVIEW_DIGIT_TYPED_AS_FEEDBACK_SCREEN))
    function Harness(): null {
      respond = useMobileNativeChatPermissionSend({
        client: { sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError,
        onResponseAccepted,
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: null,
        cardPermission: PLAN_REVIEW_CARD
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })

    await act(async () => {
      await expect(respond?.('1')).resolves.toBe(false)
    })
    expect(onSendError).toHaveBeenCalledWith(FEEDBACK_ROW_MESSAGE)
    expect(onResponseAccepted).not.toHaveBeenCalled()
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['terminal.read'])
    // The refusal released the terminal for the comment send it points to.
    expect(acquireMobileNativeChatTerminalWrite('terminal')).toBe(true)
    releaseMobileNativeChatTerminalWrite('terminal')
  })
})

/**
 * Claude Code 2.1.276, `claude --permission-mode plan`, tmux capture on
 * 2026-09-18. The ExitPlanMode review exactly as painted, highlight on row 1.
 */
const PLAN_REVIEW_SCREEN = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   ❯ 1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]

/** The same build's Bash dialog, captured in the same session two tool calls
 *  later, highlight on row 1. Option 2 wraps onto a continuation line. */
const BASH_DIALOG_SCREEN = [
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  '',
  '   echo world >> note.txt && cat note.txt',
  '   Append "world" to note.txt and show the result',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/5d877e39-1867-424',
  '      f-86b5-c080713c1563/scratchpad/plan-accept-repro from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  '',
  ' Esc to cancel · Tab to amend'
]

/** The plan-review card as the phone renders it: the screen parser cannot
 *  see this dialog, so its options come from the agent's own status text
 *  (MobileNativeChatPermission.test.ts renders exactly this shape). */
const PLAN_REVIEW_CARD = {
  title: 'Permission requested',
  detail: 'Claude has written up a plan and is ready to execute. Would you like to proceed?',
  options: [
    { label: 'Yes, and use auto mode', send: '1' },
    { label: 'Yes, manually approve edits', send: '2' },
    { label: 'Tell Claude what to change', send: '3' }
  ]
}

/** Same session, after a bare "3": the highlight moved to the feedback row
 *  and the review stayed up. This is the state a refused comment send can
 *  leave the desktop in. */
const PLAN_REVIEW_FEEDBACK_ROW_HIGHLIGHTED_SCREEN = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Ready to code?',
  '',
  "   Here is Claude's plan:",
  '  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '   Print hello to stdout with echo hello.',
  '  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '',
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '     1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '   ❯ 3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]

/** Same session, one keystroke later: a bare "1" sent while row 3 was
 *  highlighted was typed INTO the feedback field, not taken as a choice. The
 *  label is gone, so nothing on this row says "Tell Claude what to change"
 *  any more; only the card knows that row 3 is the feedback row. */
const PLAN_REVIEW_DIGIT_TYPED_AS_FEEDBACK_SCREEN = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Ready to code?',
  '',
  "   Here is Claude's plan:",
  '  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '   Print hello to stdout with echo hello.',
  '  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '',
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '     1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '   ❯ 3. 1',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]

const FEEDBACK_ROW_MESSAGE =
  'The terminal is waiting for typed feedback. Press Up in the terminal, or send your comment from here.'

function screenReply(lines: readonly string[], source: string = 'screen') {
  return { ok: true, result: { terminal: { lines, source } } }
}

const SEND_ACCEPTED = {
  ok: true,
  result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
}

describe('plan-review approvals on Claude Code 2.1.276', () => {
  // The bare digit approved the plan on the real screen, the same way the
  // Bash dialog's digit does. Sending "2" with the highlight on row 1 replaced
  // the review with
  //
  //   ⏺ User approved Claude's plan
  //   ⎿  Plan saved to: ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md · /plan to edit
  //   ⏸ manual mode on · ← for agents
  //
  // and "1" with the highlight on row 2 flipped the footer to
  // "⏵⏵ auto mode on" and ran the plan's Bash without a prompt. Only the
  // feedback row (3) is different: its digit moves the highlight and waits
  // for typing, which claude-plan-feedback-send.ts handles on its own path.
  // So the approval rows must stay a bare digit: a Return appended after a
  // digit that already submitted lands in the composer of an agent that is
  // now working, and submits whatever is drafted there.
  it.each(['1', '2'])(
    'approves a plan review with the bare digit %s after one look at the screen, no Return appended',
    async (digit) => {
      const sendRequest = vi
        .fn()
        .mockResolvedValueOnce(screenReply(PLAN_REVIEW_SCREEN))
        .mockResolvedValueOnce(SEND_ACCEPTED)
      // The screen parser knows only the Bash dialog, so the controller hands
      // this path no screen-derived card for a plan review and the Bash-style
      // recheck does not run. Pinned here because the call count below
      // depends on it.
      expect(claudePermissionFromScreen(PLAN_REVIEW_SCREEN)).toBeNull()

      await expect(
        sendMobileNativeChatPermissionResponse({
          client: { sendRequest } as unknown as RpcClient,
          terminal: 'terminal',
          deviceToken: 'phone',
          text: digit,
          expectedTerminalAgent: 'claude',
          expectedCodexPermission: claudePermissionFromScreen(PLAN_REVIEW_SCREEN),
          cardPermission: PLAN_REVIEW_CARD
        })
      ).resolves.toBe('accepted')
      expect(sendRequest).toHaveBeenCalledTimes(2)
      expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.read')
      expect(sendRequest).toHaveBeenLastCalledWith(
        'terminal.send',
        {
          terminal: 'terminal',
          text: digit,
          enter: false,
          client: { id: 'phone', type: 'mobile' }
        },
        { timeoutMs: MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS, budgetSpansConnect: true }
      )
    }
  )

  it.each([
    ['a digit already landed in the feedback field', PLAN_REVIEW_DIGIT_TYPED_AS_FEEDBACK_SCREEN],
    ['the highlight sits on "Tell Claude what to change"', PLAN_REVIEW_FEEDBACK_ROW_HIGHLIGHTED_SCREEN]
  ])('refuses the approval tap while %s, and writes nothing', async (_state, screen) => {
    const sendRequest = vi.fn().mockResolvedValue(screenReply(screen))

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '1',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: null,
        cardPermission: PLAN_REVIEW_CARD
      })
    ).resolves.toEqual({ kind: 'refused', message: FEEDBACK_ROW_MESSAGE })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.read')
  })

  it.each([
    ['the host declines the read', { ok: false, error: { message: 'no such terminal' } }],
    ['the read answers with stream scrollback, not the live frame', screenReply(PLAN_REVIEW_SCREEN, 'stream')],
    ['the screen shows no highlighted option at all', screenReply([])],
    ['the review has already left the screen', screenReply(['❯ ', '  ⏸ plan mode on (shift+tab to cycle)'])]
  ])('does not write a plan approval blind when %s', async (_why, reply) => {
    const sendRequest = vi.fn().mockResolvedValue(reply)

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '2',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: null,
        cardPermission: PLAN_REVIEW_CARD
      })
    ).resolves.toBe('rejected')
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.read')
  })

  it('reports a plan approval as rejected, not thrown, when the read itself throws', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('Connection closed'))

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '2',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: null,
        cardPermission: PLAN_REVIEW_CARD
      })
    ).resolves.toBe('rejected')
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('leaves a Bash card on its single recheck: no plan read is added', async () => {
    const card = claudePermissionFromScreen(BASH_DIALOG_SCREEN)
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(screenReply(BASH_DIALOG_SCREEN))
      .mockResolvedValueOnce(SEND_ACCEPTED)

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '1',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: card,
        cardPermission: card
      })
    ).resolves.toBe('accepted')
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['terminal.read', 'terminal.send'])
    expect(sendRequest.mock.calls[1]?.[1]).toMatchObject({ text: '1', enter: false })
  })

  it('leaves a Codex card untouched: its recheck, its shortcut, nothing more', async () => {
    const codexScreen = [
      'Would you like to run the following command?',
      '',
      '  $ pnpm exec vitest run',
      '',
      '› 1. Yes, proceed (y)',
      '  2. No, and tell Codex what to do differently (esc)',
      '',
      'Press enter to confirm or esc to cancel'
    ]
    const card = codexPermissionFromScreen(codexScreen)
    expect(card).not.toBeNull()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(screenReply(codexScreen))
      .mockResolvedValueOnce(SEND_ACCEPTED)

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: 'y',
        expectedTerminalAgent: 'codex',
        expectedCodexPermission: card,
        cardPermission: card
      })
    ).resolves.toBe('accepted')
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['terminal.read', 'terminal.send'])
    expect(sendRequest.mock.calls[1]?.[1]).toMatchObject({ text: 'y', enter: false })
  })

  it("declines the same build's Bash dialog with the bare digit 4 after rechecking the screen", async () => {
    // "4" alone on the real screen ended the turn ("Interrupted · What should
    // Claude do instead?"); the dialog had no Return to wait for.
    const expected = claudePermissionFromScreen(BASH_DIALOG_SCREEN)
    expect(expected?.options.map((option) => option.send)).toEqual(['1', '2', '3', '4'])
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { terminal: { lines: BASH_DIALOG_SCREEN } } })
      .mockResolvedValueOnce({
        ok: true,
        result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
      })

    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: 'phone',
        text: '4',
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: expected
      })
    ).resolves.toBe('accepted')
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest.mock.calls[0]?.[0]).toBe('terminal.read')
    expect(sendRequest.mock.calls[1]?.[0]).toBe('terminal.send')
    expect(sendRequest.mock.calls[1]?.[1]).toMatchObject({ text: '4', enter: false })
  })
})
