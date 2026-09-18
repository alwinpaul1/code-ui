import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS } from './mobile-native-chat-send'
import { claudePermissionFromScreen } from './claude-terminal-permission'
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
    'approves a plan review with the bare digit %s, no Return appended',
    async (digit) => {
      const sendRequest = vi.fn().mockResolvedValue({
        ok: true,
        result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
      })
      // The screen parser knows only the Bash dialog, so the controller hands
      // this path no screen-derived card for a plan review and there is no
      // recheck read before the write. Pinned here because the write count
      // below depends on it.
      expect(claudePermissionFromScreen(PLAN_REVIEW_SCREEN)).toBeNull()

      await expect(
        sendMobileNativeChatPermissionResponse({
          client: { sendRequest } as unknown as RpcClient,
          terminal: 'terminal',
          deviceToken: 'phone',
          text: digit,
          expectedTerminalAgent: 'claude',
          expectedCodexPermission: claudePermissionFromScreen(PLAN_REVIEW_SCREEN)
        })
      ).resolves.toBe('accepted')
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(sendRequest).toHaveBeenCalledWith(
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
