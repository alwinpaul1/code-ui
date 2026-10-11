import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import {
  mobileNativeChatInputResidue,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import {
  CLAUDE_2_1_296_VERSION,
  CLAUDE_ONE_QUEUED_2_1_296,
  CLAUDE_ONE_RECALLED_2_1_296,
  CLAUDE_QUEUED_TEXT,
  CLAUDE_TWO_QUEUED_2_1_296,
  CLAUDE_TWO_QUEUED_TEXTS,
  CLAUDE_TWO_RECALLED_2_1_296,
  CODEX_0_153_4_VERSION,
  CODEX_ONE_QUEUED_0_153_4,
  CODEX_ONE_RECALLED_0_153_4,
  CODEX_QUEUED_TEXT
} from './fixtures/queued-tap-recall-2.1.296-0.153.4'

// The Claude app (1.261009.20): a tap anywhere on the queued bubble calls
// rs8.dequeueToInput (z07 -> hb20.e's onClick), which clears the queued send and
// puts its text in the composer. Code UI's queue is the agent's own, drawn on
// the desktop, so the tap drives the agent's recall key (Claude Up, Codex
// Alt+Up), reads back what the agent's input now holds, and loads THAT into the
// composer. The message stays in the desktop input, out of the queue, so the
// desktop still holds it; the next send replaces it there. Screens captured from
// Claude Code 2.1.296 and Codex 0.153.4 (fixtures/queued-tap-recall-*.ts).

const UP = '\x1b[A'
const ALT_UP = '\x1b[1;3A'
const PLACEHOLDER = 'Press up to edit queued messages'

type Screen = { lines: readonly string[]; draft: string }

/** A host whose agent answers its recall key by swapping one captured screen for the next. */
function fakeHost(before: Screen, after: Screen, key: string) {
  let screen = before
  const writes: string[] = []
  const sendRequest = vi.fn(async (method: string, params: { text?: string }) => {
    if (method === 'terminal.send') {
      writes.push(params.text!)
      if (params.text === key) {
        screen = after
      }
      return { ok: true, result: { send: { accepted: true } } }
    }
    return { ok: true, result: { terminal: { source: 'screen', tail: screen.lines, draft: screen.draft } } }
  })
  return { client: { sendRequest } as unknown as RpcClient, writes }
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  resetMobileNativeChatTerminalWritesForTests()
  resetMobileNativeChatStaleInputForTests()
})

function mount(agent: 'claude' | 'codex', client: RpcClient, extra: { composer?: string; queued?: readonly string[] } = {}) {
  const onError = vi.fn()
  const onRecalled = vi.fn()
  const removePending = vi.fn()
  let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
  function Harness(): null {
    api = useMobileNativeChatQueueEditor({
      agent,
      tabId: 'tab',
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'device' },
      client,
      enabled: true,
      beforeOpen: async () => {},
      onError,
      pending: [{ id: 'own', text: agent === 'claude' ? CLAUDE_QUEUED_TEXT : CODEX_QUEUED_TEXT }],
      removePending,
      queued: extra.queued ?? ['one'],
      composerText: () => extra.composer ?? '',
      onRecalled
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Harness))
  })
  return { api: () => api, onError, onRecalled, removePending }
}

async function tap(api: ReturnType<typeof useMobileNativeChatQueueEditor>, index: number, drawn: string): Promise<void> {
  vi.useFakeTimers()
  await act(async () => {
    const done = api.recallToComposer(index, drawn)
    await vi.runAllTimersAsync()
    await done
  })
}

describe('tapping a queued message puts it back in the composer', () => {
  it(`pulls ${CLAUDE_2_1_296_VERSION}'s queued message into its input and loads what the input says`, async () => {
    const host = fakeHost(
      { lines: CLAUDE_ONE_QUEUED_2_1_296, draft: PLACEHOLDER },
      { lines: CLAUDE_ONE_RECALLED_2_1_296, draft: CLAUDE_QUEUED_TEXT },
      UP
    )
    const { api, onError, onRecalled, removePending } = mount('claude', host.client)
    await tap(api(), 0, CLAUDE_QUEUED_TEXT)

    expect(onError).not.toHaveBeenCalled()
    // One key, and nothing typed or cleared: the words stay in the desktop input.
    expect(host.writes).toEqual([UP])
    expect(onRecalled).toHaveBeenCalledWith({ handle: 'terminal', text: CLAUDE_QUEUED_TEXT })
    // No editor sheet: the composer is the editor now.
    expect(api().editor).toBeNull()
    // Its sent bubble must not come back as delivered.
    expect(removePending).toHaveBeenCalledWith('own')
    // The next send clears what the recall left on the agent before typing.
    expect(mobileNativeChatInputResidue('terminal')).toBe(CLAUDE_QUEUED_TEXT)
  })

  it(`pulls ${CODEX_0_153_4_VERSION}'s latest follow-up into its composer with Alt+Up`, async () => {
    const host = fakeHost(
      { lines: CODEX_ONE_QUEUED_0_153_4, draft: '' },
      { lines: CODEX_ONE_RECALLED_0_153_4, draft: CODEX_QUEUED_TEXT },
      ALT_UP
    )
    const { api, onError, onRecalled } = mount('codex', host.client)
    await tap(api(), 0, CODEX_QUEUED_TEXT)

    expect(onError).not.toHaveBeenCalled()
    expect(host.writes).toEqual([ALT_UP])
    expect(onRecalled).toHaveBeenCalledWith({ handle: 'terminal', text: CODEX_QUEUED_TEXT })
    expect(api().editor).toBeNull()
  })

  it.each(['claude', 'codex'] as const)('refuses before any key while the %s composer holds a draft', async (agent) => {
    const host = agent === 'claude'
      ? fakeHost({ lines: CLAUDE_ONE_QUEUED_2_1_296, draft: PLACEHOLDER }, { lines: CLAUDE_ONE_RECALLED_2_1_296, draft: CLAUDE_QUEUED_TEXT }, UP)
      : fakeHost({ lines: CODEX_ONE_QUEUED_0_153_4, draft: '' }, { lines: CODEX_ONE_RECALLED_0_153_4, draft: CODEX_QUEUED_TEXT }, ALT_UP)
    const { api, onError, onRecalled } = mount(agent, host.client, { composer: 'half a thought' })
    await tap(api(), 0, agent === 'claude' ? CLAUDE_QUEUED_TEXT : CODEX_QUEUED_TEXT)

    expect(host.writes).toEqual([])
    expect(onRecalled).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Send or clear your message first, then tap the queued one.')
  })

  it('refuses, and loads nothing, when the input never shows the message', async () => {
    // The key went out and the agent's input stayed on its placeholder.
    const host = fakeHost(
      { lines: CLAUDE_ONE_QUEUED_2_1_296, draft: PLACEHOLDER },
      { lines: CLAUDE_ONE_QUEUED_2_1_296, draft: PLACEHOLDER },
      UP
    )
    const { api, onError, onRecalled } = mount('claude', host.client)
    await tap(api(), 0, CLAUDE_QUEUED_TEXT)

    expect(onRecalled).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0]![0])).toMatch(/could not read/i)
  })

  it(`opens the editor instead when stock ${CLAUDE_2_1_296_VERSION} would pull the whole queue in`, async () => {
    // One Up empties both messages into the input. Loading one of them into the
    // composer would leave the other only on the phone, so the sheet that puts
    // the rest back takes over (native-queue-editor.ts, rebuild).
    const host = fakeHost(
      { lines: CLAUDE_TWO_QUEUED_2_1_296, draft: PLACEHOLDER },
      { lines: CLAUDE_TWO_RECALLED_2_1_296, draft: CLAUDE_TWO_QUEUED_TEXTS.join('\n') },
      UP
    )
    const { api, onError, onRecalled } = mount('claude', host.client, { queued: CLAUDE_TWO_QUEUED_TEXTS })
    await tap(api(), 0, CLAUDE_TWO_QUEUED_TEXTS[0])

    expect(onError).not.toHaveBeenCalled()
    expect(onRecalled).not.toHaveBeenCalled()
    expect(api().editor?.text).toBe(CLAUDE_TWO_QUEUED_TEXTS[0])
    expect(api().editor?.rebuilds).toBe(true)
  })
})
