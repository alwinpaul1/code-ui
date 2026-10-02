// A Claude send must not type into a terminal whose screen does not show Claude's
// input box.
//
// Reported 2026-10-02: Claude exits back to the shell in the same terminal. The
// tab still claims `claude` (a hand-started agent's type outlives its process by
// about 30 minutes), the screen shows a shell prompt, and the send, which failed
// OPEN on a screen with no composer, cleared and typed the message plus Enter
// into zsh, where it RAN as a command.
//
// Screens: fixtures/claude-exited-to-shell-2.1.287.ts (shell prompts captured
// with tmux, the rest modelled; it says which) and the composer fixtures. Claude
// Code builds: 2.1.287 box, 2.1.285 named-rule queued screen. Not captured live
// here, so MODELLED from the same paddingX: 2 rows: the slash popup, vim's
// `-- INSERT --`, bash mode and transcript mode.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { createFakeComposerHost } from './fake-claude-composer-host.test-support'
import { composerWithTextInRows, EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import {
  claudeBoxThenShell,
  claudeExitedToShell,
  plainShell,
  SHELL_PROMPTS
} from './fixtures/claude-exited-to-shell-2.1.287'
import {
  NAMED_RULES,
  queuedScreen2_1_285
} from './fixtures/claude-queued-named-rule-2.1.285'
import { claudeLiveFrame } from './mobile-native-chat-send-follow'
import {
  readSendUnderDialogRefusal,
  SEND_UNDER_DIALOG_REFUSAL,
  SEND_WITHOUT_COMPOSER_REFUSAL
} from './mobile-native-chat-dialog-guard'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { makeClient } from './use-mobile-native-chat-image-attachments.test-support'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const RULE = '─'.repeat(190)
const FOOTER = ['  [Opus 5.5 xhigh | Max 20x] ██░░░░░░░░ 16% (162k/1.0M) | Project git:(main)']
/** `source: null` leaves the field out, as an older host does. */
const reply = (lines: string[], source: string | null = 'screen'): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { lines, ...(source === null ? {} : { source }) } },
  _meta: { runtimeId: 'r' }
})
const subagentPrompt = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-subagent-bash-permission-2.1.283.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
const SUBAGENT_DIALOG = subagentPrompt.slice(
  subagentPrompt.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1
)

const look = (
  response: RpcResponse | Error,
  agent: string | null = 'claude',
  requireComposer = true
) =>
  readSendUnderDialogRefusal({
    client: makeClient(() => {
      if (response instanceof Error) {
        throw response
      }
      return response
    }) as unknown as RpcClient,
    terminal: 'term',
    agent,
    requireComposer
  } as Parameters<typeof readSendUnderDialogRefusal>[0])

/** Screens where Claude's input box is NOT up: the send has to stop. */
const NO_COMPOSER: [string, string[]][] = [
  ['a zsh prompt under Claude\'s last frame', claudeExitedToShell(SHELL_PROMPTS.zsh)],
  ['a bash $ prompt under Claude\'s last frame', claudeExitedToShell(SHELL_PROMPTS.bash)],
  ['a fish > prompt under Claude\'s last frame', claudeExitedToShell(SHELL_PROMPTS.fish)],
  ['a starship ❯ prompt, Claude\'s own glyph, under its last frame', claudeExitedToShell(SHELL_PROMPTS.starship)],
  ['the resume hint Claude prints on exit', claudeExitedToShell(SHELL_PROMPTS.resumeHint)],
  ['Claude\'s box with only a zsh prompt under its bottom rule', claudeBoxThenShell(SHELL_PROMPTS.zsh)],
  ['a plain zsh with no box', plainShell(SHELL_PROMPTS.zsh)],
  ['a plain bash with no box', plainShell(SHELL_PROMPTS.bash)],
  ['a plain fish with no box', plainShell(SHELL_PROMPTS.fish)],
  // Ctrl+O: a full-screen transcript view, no input box.
  [
    'transcript mode (ctrl+o)',
    ['Showing detailed transcript · ctrl+o to toggle · ctrl+e to show all', '', '⏺ Done.']
  ],
  // `!` bash mode: the prompt char is `!`, and what is typed runs as a command.
  ['bash mode (the ! composer)', ['⏺ Done.', RULE, '! ls', RULE, '  ! for bash mode']]
]

/** Selected or hovered rows of Claude Code 2.1.287's agents panel (glyphs read
 *  from the binary): `◯` unviewed, `⏺` (macOS) or `●` viewed, `⏸` paused
 *  workflow, a tree connector first on nested task rows. */
const PANEL_ROWS: [string, string][] = [
  ['an unviewed task row', '❯ ◯ general-purpose  Probe the relay'],
  ['the viewed main row on macOS', '❯ ⏺ main'],
  ['the viewed main row elsewhere', '❯ ● main'],
  ['a depth-1 child row', '❯ ├ ◯ child'],
  ['a depth-2 grandchild row', '❯   └ ◯ grandchild'],
  ['a paused workflow row', '❯ ⏸ workflow']
]

const LEGIT: [string, string[]][] = [
  ['an idle composer with a user status line', EMPTY_COMPOSER],
  [
    'Claude working (spinner above the box)',
    ['⏺ Bash(sleep 30)', '✻ Pondering… (12s · esc to interrupt)', RULE, '❯ ', RULE, ...FOOTER]
  ],
  ['a queued message under a plain rule (2.1.285)', queuedScreen2_1_285(NAMED_RULES.bare)],
  ['a queued message under a named rule (2.1.285 capture)', queuedScreen2_1_285(NAMED_RULES.captured1152)],
  [
    'a named rule on an idle composer',
    ['⏺ Done.', NAMED_RULES.captured1152, '❯ ', RULE, ...FOOTER]
  ],
  [
    "Claude's grey prompt suggestion as the placeholder",
    ['⏺ Done.', RULE, '❯ Try "fix the failing test"', RULE, ...FOOTER]
  ],
  [
    'the slash-command popup under the box (modelled)',
    [
      '⏺ Done.',
      RULE,
      '❯ /mo',
      RULE,
      '  /model                 Set the AI model for Claude Code',
      '  /mobile                Show the mobile app QR code'
    ]
  ],
  ['vim mode, -- INSERT -- under the box (modelled)', ['⏺ Done.', RULE, '❯ ', RULE, '  -- INSERT --']],
  ['text typed on the desktop, in the rows', composerWithTextInRows('half a thought')],
  // 2.1.287's agents panel under the footer has no left padding: a selected or
  // mouse-hovered row starts with `❯ ` at column 0 (a desk mouse resting on it).
  ['an agents panel, no row selected', ['⏺ Done.', RULE, '❯ ', RULE, ...FOOTER, '  ◯ main', '  ◯ general-purpose  Probe the relay   1m 3s']],
  ...PANEL_ROWS.map(([name, row]): [string, string[]] => [
    `an agents panel with ${name} hovered (2.1.287)`,
    ['⏺ Done.', RULE, '❯ ', RULE, ...FOOTER, row, '  ◯ general-purpose  Probe the relay   1m 3s']
  ]),
  // The footer is `null` in default mode with the hint suppressed: nothing under
  // the box. A shell leaves its prompt there, so an EMPTY area is not a shell.
  ['no status line and no footer at all', ['⏺ Done.', RULE, '❯ ', RULE]]
]

describe('a Claude send that finds no input box on the desktop screen', () => {
  it.each(NO_COMPOSER)('is refused for %s', async (_name, lines) => {
    expect(await look(reply(lines))).toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('says why, and what to do', () => {
    expect(SEND_WITHOUT_COMPOSER_REFUSAL).toBe(
      "Claude's input box isn't on the desktop screen, so the message was not typed."
    )
  })

  it.each(LEGIT)('still sends from %s', async (_name, lines) => {
    expect(await look(reply(lines))).toBeNull()
  })

  it('does not look for the box unless the send asked for it', async () => {
    expect(await look(reply(claudeExitedToShell(SHELL_PROMPTS.zsh)), 'claude', false)).toBeNull()
  })

  it('names a waiting prompt, not the missing box, when a dialog replaced it', async () => {
    expect(await look(reply(SUBAGENT_DIALOG))).toBe(SEND_UNDER_DIALOG_REFUSAL)
  })

  // Failing OPEN is the stated gap: a phone that cannot read a screen cannot tell
  // a shell from Claude, and refusing every send to an older host would be the
  // worse bug.
  it.each([
    ['a reply with no source (an older host sends the stream tail)', reply(claudeExitedToShell('66% '), null)],
    ['a stream tail', reply(claudeExitedToShell('66% '), 'stream')],
    ['a rejected read', { id: 'r', ok: false, error: { code: 'x', message: 'no' }, _meta: { runtimeId: 'r' } } as RpcResponse],
    ['a reply that is no screen', { id: 'r', ok: true, result: { terminal: {} }, _meta: { runtimeId: 'r' } } as RpcResponse],
    ['a read that throws', new Error('timed out')]
  ])('still sends when the screen cannot be read: %s', async (_name, response) => {
    expect(await look(response)).toBeNull()
  })

  it('leaves Codex alone, whatever its screen shows', async () => {
    expect(await look(reply(plainShell(SHELL_PROMPTS.zsh)), 'codex')).toBeNull()
    expect(await look(reply(claudeExitedToShell(SHELL_PROMPTS.bash)), 'codex')).toBeNull()
  })

  it('leaves an agent that is not Claude alone', async () => {
    expect(await look(reply(plainShell(SHELL_PROMPTS.zsh)), 'openclaude')).toBeNull()
    expect(await look(reply(plainShell(SHELL_PROMPTS.zsh)), null)).toBeNull()
  })

  // Degenerate sizes: no rows at all, and a box with one row under it.
  it('refuses an empty screen and accepts a one-row-under box', async () => {
    expect(await look(reply([]))).toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
    expect(await look(reply([RULE, '❯ ', RULE, '  ? for shortcuts']))).toBeNull()
  })
})

describe('the remint follow reads a hovered agents-panel row as Claude too', () => {
  it.each(PANEL_ROWS)('accepts the box with %s hovered', (_name, row) => {
    expect(claudeLiveFrame(['⏺ Done.', RULE, '❯ ', RULE, ...FOOTER, row])).toBe(true)
  })

  it('still refuses a starship prompt under the box', () => {
    expect(claudeLiveFrame(claudeExitedToShell(SHELL_PROMPTS.starship))).toBe(false)
  })
})

// ─── Through the real send ───────────────────────────────────────────────────

type Write = { text: string; enter: boolean }

/** A terminal whose screen is whatever the test says, recording what is typed. */
function screenHost(screen: (() => RpcResponse) | Error) {
  const writes: Write[] = []
  const handle = vi.fn(async (method: string, params: unknown) => {
    const body = (params ?? {}) as { text?: string; enter?: boolean }
    if (method === 'terminal.send') {
      writes.push({ text: body.text ?? '', enter: body.enter === true })
      return { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'r' } }
    }
    if (method === 'terminal.read') {
      if (screen instanceof Error) {
        throw screen
      }
      return screen()
    }
    throw new Error(`unexpected ${method}`)
  })
  return { writes, handle }
}

describe('the real send onto a terminal with no Claude input box', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const acceptSend = vi.fn()
  const clearDraftForSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const report = vi.fn()

  const mount = (handle: ReturnType<typeof vi.fn>, agent: string | null = 'claude'): void => {
    const client = {
      sendRequest: handle,
      getState: () => 'connected',
      notifyForeground: vi.fn()
    } as unknown as RpcClient
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend,
        restoreRejectedDraft,
        acceptSend,
        holdUnconfirmedSend: vi.fn(),
        onSendError: report
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  async function run<T>(start: () => Promise<T>): Promise<T> {
    let result!: T
    await act(async () => {
      const running = start()
      await vi.runAllTimersAsync()
      result = await running
    })
    return result
  }

  beforeEach(() => {
    vi.useFakeTimers()
    for (const fn of [acceptSend, clearDraftForSend, restoreRejectedDraft, report]) {
      fn.mockReset()
    }
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
    vi.useRealTimers()
  })

  it.each(NO_COMPOSER.slice(0, 9))(
    'does not type the message into the shell, and keeps the draft: %s',
    async (_name, lines) => {
      const host = screenHost(() => reply(lines))
      mount(host.handle)

      const outcome = await run(() => api!.sendWithOutcome('rm -rf build'))

      expect(outcome).toBe('rejected')
      expect(host.writes).toEqual([])
      expect(acceptSend).not.toHaveBeenCalled()
      // Refused before the composer was emptied: the draft never left.
      expect(clearDraftForSend).not.toHaveBeenCalled()
      expect(restoreRejectedDraft).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL)
    }
  )

  it('does not type a slash command picked in the chat into the shell', async () => {
    const host = screenHost(() => reply(claudeExitedToShell(SHELL_PROMPTS.zsh)))
    mount(host.handle)
    const onError = vi.fn()

    const outcome = await run(() => api!.dispatchCommand('/model sonnet', { onError }))

    expect(outcome).toBe('rejected')
    expect(host.writes).toEqual([])
    expect(onError).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('does not type an answer to a question into the shell', async () => {
    const host = screenHost(() => reply(claudeExitedToShell(SHELL_PROMPTS.bash)))
    mount(host.handle)

    const accepted = await run(() => api!.answerQuestion('yes, go ahead'))

    expect(accepted).toBe(false)
    expect(host.writes).toEqual([])
    expect(report).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('names the waiting prompt, once, when a dialog took the box away', async () => {
    const host = screenHost(() => reply(SUBAGENT_DIALOG))
    mount(host.handle)

    const outcome = await run(() => api!.sendWithOutcome('push it'))

    expect(outcome).toBe('rejected')
    expect(host.writes).toEqual([])
    expect(report).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
  })

  it('still sends to a live Claude box', async () => {
    const host = createFakeComposerHost()
    mount(host.handle)

    const outcome = await run(() => api!.sendWithOutcome('check the build'))

    expect(outcome).toBe('accepted')
    expect(host.submitted).toEqual(['check the build'])
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('still sends to a live box with no footer under it (default mode, hint suppressed)', async () => {
    const host = createFakeComposerHost()
    const footerless = vi.fn(async (method: string, params: unknown) => {
      const response = (await host.handle(method, params)) as {
        result: { terminal?: { tail: string[] } }
      }
      if (method === 'terminal.read' && response.result.terminal) {
        response.result.terminal.tail = response.result.terminal.tail.filter(
          (row) => !row.startsWith('  ')
        )
      }
      return response
    })
    mount(footerless)

    const outcome = await run(() => api!.sendWithOutcome('check the build'))

    expect(outcome).toBe('accepted')
    expect(host.submitted).toEqual(['check the build'])
  })

  // The gap, pinned: with no screen to read, nothing can tell a shell from
  // Claude, so the send goes as it did before the screen was looked at.
  it('still sends when the screen cannot be read at all (the stated gap)', async () => {
    const host = screenHost(new Error('timed out'))
    mount(host.handle)

    await run(() => api!.sendWithOutcome('check the build'))

    expect(host.writes.some((write) => write.text.includes('check the build'))).toBe(true)
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
  })

  it('still sends when the host answers with a stream tail, not a screen (the stated gap)', async () => {
    const host = screenHost(() => reply(claudeExitedToShell(SHELL_PROMPTS.zsh), null))
    mount(host.handle)

    await run(() => api!.sendWithOutcome('check the build'))

    expect(host.writes.some((write) => write.text.includes('check the build'))).toBe(true)
  })

  it('leaves Codex as it was: its screen is not looked at for a box', async () => {
    const host = screenHost(() => reply(plainShell(SHELL_PROMPTS.zsh)))
    mount(host.handle, 'codex')

    await run(() => api!.sendWithOutcome('check the build'))

    expect(host.writes.some((write) => write.text.includes('check the build'))).toBe(true)
    expect(report).not.toHaveBeenCalledWith(SEND_WITHOUT_COMPOSER_REFUSAL)
  })
})
