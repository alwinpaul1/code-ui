import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { forkClaudeSessionUnlessDialog } from './claude-fork-session'
import { applyCodexPickerSelection, type CodexPickerIo } from './codex-picker-apply'
import { SEND_UNDER_DIALOG_REFUSAL } from './mobile-native-chat-dialog-guard'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  return rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
}

// Claude Code 2.1.283, 2026-09-27: a subagent's Bash prompt with "Yes"
// highlighted. Anything the chat types into it is an answer, and an Enter
// approves the command.
const SUBAGENT_PROMPT = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
const DIALOG_AT = SUBAGENT_PROMPT.findIndex((row) => row.startsWith('─'))
const NO_DIALOG = [...SUBAGENT_PROMPT.slice(0, DIALOG_AT), '─'.repeat(99), '❯ ', '─'.repeat(99)]
// A Codex approval as the phone saw it (codex-terminal-permission.test.ts),
// under a question its reader does not know.
const CODEX_UNREAD = [
  'Would you like to apply the following change?',
  '',
  '› 1. Yes, proceed (y)',
  '  2. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

type Call = { method: string; params: { text?: string } }

/** A connected client that answers a screen read with `screen` and accepts
 *  every write, recording each call. */
function client(screen: () => string[] | Promise<never>) {
  const calls: Call[] = []
  return {
    calls,
    writes: () => calls.filter((call) => call.method === 'terminal.send'),
    rpc: {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params: params as Call['params'] })
        if (method === 'terminal.read') {
          return { ok: true, result: { terminal: { lines: await screen(), source: 'screen' } } }
        }
        return { ok: true, result: { send: { handle: 'term', accepted: true, bytesWritten: 1 } } }
      })
    } as unknown as RpcClient & { calls: Call[] }
  }
}

beforeEach(() => {
  resetMobileNativeChatStaleInputForTests()
  resetMobileNativeChatTerminalWritesForTests()
})

describe('a question-card answer or a session-option pick while a prompt waits', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(rpc: RpcClient, agent: string, onSendError = vi.fn()) {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: rpc,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'phone' },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: vi.fn(),
        restoreRejectedDraft: vi.fn(),
        acceptSend: vi.fn(),
        holdUnconfirmedSend: vi.fn(),
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    return onSendError
  }

  it('does not type a question answer into the dialog', async () => {
    const host = client(() => SUBAGENT_PROMPT)
    const onSendError = mount(host.rpc, 'claude')
    let answered: boolean | undefined
    await act(async () => {
      answered = await api!.answerQuestion('1')
    })
    expect(answered).toBe(false)
    expect(host.writes()).toEqual([])
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
  })

  it.each([
    ['claude', SUBAGENT_PROMPT],
    ['codex', CODEX_UNREAD]
  ])('does not type a %s session-option pick into the dialog, and says why where the pick shows errors', async (agent, lines) => {
    const host = client(() => lines)
    mount(host.rpc, agent)
    const say = vi.fn()
    let outcome: string | undefined
    await act(async () => {
      outcome = await api!.dispatchCommand('/model sonnet', { onError: say })
    })
    expect(outcome).toBe('rejected')
    expect(host.writes()).toEqual([])
    expect(say).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
  })

  it('types the pick as before once the prompt has left the screen', async () => {
    const host = client(() => NO_DIALOG)
    mount(host.rpc, 'claude')
    await act(async () => {
      await api!.dispatchCommand('/model sonnet')
    })
    expect(host.writes().some((call) => call.params.text?.includes('/model sonnet'))).toBe(true)
  })

  // Fails open: a pick that cannot look goes as every pick went before.
  it('types the pick as before when the screen read fails', async () => {
    const host = client(() => Promise.reject(new Error('Connection closed')))
    mount(host.rpc, 'claude')
    await act(async () => {
      await api!.dispatchCommand('/model sonnet')
    })
    expect(host.writes().some((call) => call.params.text?.includes('/model sonnet'))).toBe(true)
  })
})

describe('the queue box\'s "Send now" while a prompt waits', () => {
  let renderer: ReactTestRenderer | null = null
  let queue: ReturnType<typeof useMobileNativeChatQueueEditor> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function sendNow(lines: string[]) {
    const host = client(() => lines)
    const onError = vi.fn()
    function Harness(): null {
      queue = useMobileNativeChatQueueEditor({
        agent: 'claude',
        tabId: 'tab',
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'phone' },
        client: host.rpc,
        enabled: true,
        beforeOpen: async () => undefined,
        onError,
        pending: [],
        removePending: vi.fn(),
        queued: ['first queued']
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let sent: boolean | undefined
    await act(async () => {
      sent = await queue!.sendNow()
    })
    return { host, onError, sent }
  }

  it('does not press the send-now key into the dialog', async () => {
    const { host, onError, sent } = await sendNow(SUBAGENT_PROMPT)
    expect(sent).toBe(false)
    expect(host.writes()).toEqual([])
    expect(onError).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
  })

  it('presses it as before with no prompt up', async () => {
    const { host, sent } = await sendNow(NO_DIALOG)
    expect(sent).toBe(true)
    expect(host.writes()).toHaveLength(1)
  })
})

describe('/fork from the tab menu while a prompt waits', () => {
  it('does not type /fork into the dialog, and says why', async () => {
    const host = client(() => SUBAGENT_PROMPT)
    await expect(
      forkClaudeSessionUnlessDialog({ client: host.rpc, terminal: 'term', deviceToken: null })
    ).resolves.toEqual({ forked: false, refusal: SEND_UNDER_DIALOG_REFUSAL })
    expect(host.writes()).toEqual([])
  })

  it('forks as before with no prompt up', async () => {
    const host = client(() => NO_DIALOG)
    await expect(
      forkClaudeSessionUnlessDialog({ client: host.rpc, terminal: 'term', deviceToken: null })
    ).resolves.toEqual({ forked: true, refusal: null })
    expect(host.writes()).toHaveLength(1)
  })
})

describe("Codex's model picker while a prompt waits", () => {
  it('types nothing into a Codex dialog its reader does not know', async () => {
    // Time moves, so a picker that never opens times out instead of spinning.
    let clock = 0
    const io: CodexPickerIo = {
      readScreen: async () => CODEX_UNREAD,
      sendKey: vi.fn(async () => true),
      typeCommand: vi.fn(async () => true),
      sleep: async () => {},
      now: () => (clock += 1_000)
    }
    await expect(applyCodexPickerSelection(io, { model: 'gpt-6' })).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(io.typeCommand).not.toHaveBeenCalled()
    expect(io.sendKey).not.toHaveBeenCalled()
  })
})

// The way out of a dialog is never refused: Stop is Escape (Ctrl+C on Grok).
describe('Stop while a prompt waits', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('still sends its Escape, without looking at the screen', async () => {
    const host = client(() => SUBAGENT_PROMPT)
    let stop: (() => void) | null = null
    function Harness(): null {
      stop = useMobileNativeChatStop({
        client: host.rpc,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'phone' },
        streamIdentity: 's',
        agent: 'claude',
        cancelPending: vi.fn(),
        onSendError: vi.fn()
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      stop!()
      await Promise.resolve()
    })
    expect(host.calls.some((call) => call.method === 'terminal.read')).toBe(false)
    expect(host.writes()[0]?.params.text).toBe('\u001b')
  })
})
