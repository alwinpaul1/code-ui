// A Codex send must not type into a terminal whose screen does not show Codex's
// composer, the same hazard as Claude's (mobile-native-chat-send-without-composer
// .test.ts): the tab still says `codex` after the process is gone and the
// message plus Enter runs in the shell. Codex had no check at all.
//
// Screens: fixtures/codex-composer-screens.ts (Codex 0.155.1 and 0.158.0 REAL,
// the exit-to-shell screens MODELLED, 0.153.4 not captured). Claude is the
// control: it keeps its own rule.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import {
  APPROVAL_0158,
  CODEX_EXITED_PROMPTS,
  codexExitedToShell,
  IDLE_AFTER_TURN_0158,
  plainShellScreen,
  TRUST_PROMPT_0158,
  withoutBlankRows,
  WORKING_0155,
  WORKING_0158
} from './fixtures/codex-composer-screens'
import {
  readSendUnderDialogRefusal,
  SEND_SCREEN_UNAVAILABLE_REFUSAL,
  SEND_SCREEN_UNREADABLE_REFUSAL,
  SEND_UNDER_DIALOG_REFUSAL,
  SEND_WITHOUT_CODEX_COMPOSER_REFUSAL,
  SEND_WITHOUT_COMPOSER_REFUSAL
} from './mobile-native-chat-dialog-guard'
import { agentComposerOnScreen } from './mobile-native-chat-send-follow'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { makeClient } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const reply = (lines: string[], source: string | null = 'screen'): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { tail: lines, ...(source === null ? {} : { source }) } },
  _meta: { runtimeId: 'r' }
})

const look = (response: RpcResponse | Error, agent: string | null = 'codex') =>
  readSendUnderDialogRefusal({
    client: makeClient(() => {
      if (response instanceof Error) {
        throw response
      }
      return response
    }) as unknown as RpcClient,
    terminal: 'term',
    agent,
    requireComposer: true
  } as Parameters<typeof readSendUnderDialogRefusal>[0])

const SHELLS: [string, string[]][] = [
  ['a zsh prompt under Codex\'s last frame and its exit lines', codexExitedToShell(WORKING_0158, CODEX_EXITED_PROMPTS.zsh)],
  ['a bash prompt under Codex\'s last frame', codexExitedToShell(IDLE_AFTER_TURN_0158, CODEX_EXITED_PROMPTS.bash, false)],
  ['a footer-shaped column-0 prompt under 0.155.1\'s last frame', codexExitedToShell(WORKING_0155, CODEX_EXITED_PROMPTS.footerShaped)],
  ['a plain shell', plainShellScreen(CODEX_EXITED_PROMPTS.zsh)],
  ['an empty screen', []]
]

describe('a Codex send that finds no composer on the desktop screen', () => {
  it.each(SHELLS)('is refused for %s', async (_name, lines) => {
    expect(await look(reply(lines))).toBe(SEND_WITHOUT_CODEX_COMPOSER_REFUSAL)
  })

  it('says why, in Codex\'s own name', () => {
    expect(SEND_WITHOUT_CODEX_COMPOSER_REFUSAL).toBe(
      "Codex's input box isn't on the desktop screen, so the message was not typed."
    )
  })

  it.each([
    ['0.158.0 idle', IDLE_AFTER_TURN_0158],
    ['0.158.0 mid-turn', WORKING_0158],
    ['0.158.0 mid-turn, blank rows dropped', withoutBlankRows(WORKING_0158)],
    ['0.155.1 mid-turn', WORKING_0155]
  ])('still sends from a real Codex %s screen', async (_name, lines) => {
    expect(await look(reply(lines))).toBeNull()
  })

  it('leaves the approval and the trust prompt to the dialog check', async () => {
    expect(await look(reply(APPROVAL_0158))).toBe(SEND_UNDER_DIALOG_REFUSAL)
    expect(await look(reply(TRUST_PROMPT_0158))).toBe(SEND_UNDER_DIALOG_REFUSAL)
  })

  it('does not look for a box on a reply that does not say it is a screen (an older host)', async () => {
    expect(await look(reply(plainShellScreen('66% '), null))).toBeNull()
  })

  it('is refused when the host has no screen to show', async () => {
    const response: RpcResponse = {
      id: 'r',
      ok: true,
      result: { terminal: { tail: [], source: 'screen-unavailable' } },
      _meta: { runtimeId: 'r' }
    }
    expect(await look(response)).toBe(SEND_SCREEN_UNAVAILABLE_REFUSAL)
    expect(SEND_SCREEN_UNREADABLE_REFUSAL).toContain("Couldn't read")
  })

  it('leaves an agent that is not Codex or Claude alone', async () => {
    expect(await look(reply(plainShellScreen('66% ')), 'openclaude')).toBeNull()
    expect(await look(reply(plainShellScreen('66% ')), null)).toBeNull()
  })

  it('keeps Claude on its own rule: a Codex frame is no Claude box, and the Claude message stays Claude\'s', async () => {
    expect(await look(reply(WORKING_0158), 'claude')).toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
    expect(await look(reply(EMPTY_COMPOSER), 'claude')).toBeNull()
  })
})

describe('the remint follow of a Codex tab', () => {
  const answering = (lines: string[]) =>
    makeClient(() => reply(lines)) as unknown as RpcClient

  it('follows onto a terminal that shows Codex\'s composer', async () => {
    expect(
      await agentComposerOnScreen({ client: answering(WORKING_0158), terminal: 't2', agent: 'codex' })
    ).toBe(true)
  })

  it.each(SHELLS)('does not follow onto %s', async (_name, lines) => {
    expect(
      await agentComposerOnScreen({ client: answering(lines), terminal: 't2', agent: 'codex' })
    ).toBe(false)
  })

  it('still does not follow for an agent whose composer it cannot locate', async () => {
    expect(
      await agentComposerOnScreen({ client: answering(WORKING_0158), terminal: 't2', agent: 'omp' })
    ).toBe(false)
  })
})

// ─── Through the real send ───────────────────────────────────────────────────

type Write = { text: string; enter: boolean }

function screenHost(screen: () => RpcResponse) {
  const writes: Write[] = []
  const handle = vi.fn(async (method: string, params: unknown) => {
    const body = (params ?? {}) as { text?: string; enter?: boolean }
    if (method === 'terminal.send') {
      writes.push({ text: body.text ?? '', enter: body.enter === true })
      return { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'r' } }
    }
    if (method === 'terminal.read') {
      return screen()
    }
    throw new Error(`unexpected ${method}`)
  })
  return { writes, handle }
}

describe('the real send onto a Codex terminal', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const acceptSend = vi.fn()
  const clearDraftForSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const report = vi.fn()

  const mount = (handle: ReturnType<typeof vi.fn>, agent = 'codex'): void => {
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

  it.each(SHELLS.slice(0, 4))(
    'does not type the message into the shell, and keeps the draft: %s',
    async (_name, lines) => {
      const host = screenHost(() => reply(lines))
      mount(host.handle)

      const outcome = await run(() => api!.sendWithOutcome('rm -rf build'))

      expect(outcome).toBe('rejected')
      expect(host.writes).toEqual([])
      expect(clearDraftForSend).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledExactlyOnceWith(SEND_WITHOUT_CODEX_COMPOSER_REFUSAL)
    }
  )

  it('still sends to a Codex composer', async () => {
    const host = screenHost(() => reply(WORKING_0158))
    mount(host.handle)

    await run(() => api!.sendWithOutcome('check the build'))

    expect(host.writes.some((write) => write.text.includes('check the build'))).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })
})
