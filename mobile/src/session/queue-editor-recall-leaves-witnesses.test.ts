// The queue editor's side of "I tried to edit a queued job and it got
// duplicated" (2026-10-15, queue-recalls.ts): a recall tells the chat which
// messages left the agent's queue for its input, and takes back only the
// phone's own send of them. A witness the chat stored of a message sent
// elsewhere is the chat's to withdraw, by the id of the entry recalled.
//
// The screens are the captures of fixtures/queued-tap-recall-2.1.296-0.153.4.ts
// (Claude Code 2.1.296 stock, Codex 0.153.4) with the `draft` Orca publishes,
// as queued-message-tap-to-composer.test.ts serves them.

import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { phoneQueueRecallsForTests, resetQueueRecallsForTests } from './queue-recalls'
import {
  CLAUDE_ONE_QUEUED_2_1_296,
  CLAUDE_ONE_RECALLED_2_1_296,
  CLAUDE_QUEUED_TEXT,
  CODEX_ONE_QUEUED_0_153_4,
  CODEX_ONE_RECALLED_0_153_4,
  CODEX_QUEUED_TEXT
} from './fixtures/queued-tap-recall-2.1.296-0.153.4'

beforeEach(() => resetQueueRecallsForTests())
afterEach(() => {
  vi.useRealTimers()
  resetMobileNativeChatTerminalWritesForTests()
  resetMobileNativeChatStaleInputForTests()
})

type Screen = { lines: readonly string[]; draft: string }
const SCREENS = {
  claude: {
    text: CLAUDE_QUEUED_TEXT,
    queued: { lines: CLAUDE_ONE_QUEUED_2_1_296, draft: 'Press up to edit queued messages' },
    recalled: { lines: CLAUDE_ONE_RECALLED_2_1_296, draft: CLAUDE_QUEUED_TEXT },
    key: '\x1b[A'
  },
  codex: {
    text: CODEX_QUEUED_TEXT,
    queued: { lines: CODEX_ONE_QUEUED_0_153_4, draft: '' },
    recalled: { lines: CODEX_ONE_RECALLED_0_153_4, draft: CODEX_QUEUED_TEXT },
    key: '\x1b[1;3A'
  }
} as const

it.each(['claude', 'codex'] as const)(
  'tells the chat what a %s recall took out of the queue and leaves the chat its stored witness of the message',
  async (agent) => {
    vi.useFakeTimers()
    const { text, queued, recalled, key } = SCREENS[agent]
    let screen: Screen = queued
    const sendRequest = vi.fn(async (method: string, params: { text?: string }) => {
      if (method === 'terminal.send') {
        if (params.text === key) {
          screen = recalled
        }
        return { ok: true, result: { send: { accepted: true } } }
      }
      return { ok: true, result: { terminal: { source: 'screen', tail: screen.lines, draft: screen.draft } } }
    })
    const removePending = vi.fn()
    const onError = vi.fn()
    let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
    function Harness() {
      api = useMobileNativeChatQueueEditor({
        agent,
        tabId: 'tab',
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: 'phone' },
        client: { sendRequest } as unknown as RpcClient,
        enabled: true,
        beforeOpen: async () => undefined,
        // The box's stored witness of the desk message, stored after the
        // phone's own send of the same words.
        pending: [
          { id: 'pending-outbox-send-1', text },
          { id: 'absorbed-dahexy-31@c23a95c6', text }
        ],
        removePending,
        onError
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      const opening = api.open(0, text)
      await vi.runAllTimersAsync()
      await opening
    })
    expect(onError).not.toHaveBeenCalled()
    expect(api.editor?.text).toBe(text)
    expect(phoneQueueRecallsForTests()).toEqual([text])
    expect(removePending).toHaveBeenCalledExactlyOnceWith('pending-outbox-send-1')
    await act(async () => renderer.unmount())
  }
)

it('notes nothing when the queue had already let the message go before the recall', async () => {
  vi.useFakeTimers()
  // The agent took it between the phone's last read and the tap.
  const empty: Screen = { lines: CLAUDE_ONE_RECALLED_2_1_296.map((line) => (line === `❯ ${CLAUDE_QUEUED_TEXT}` ? '❯' : line)), draft: '' }
  const sendRequest = vi.fn(async (method: string) =>
    method === 'terminal.send'
      ? { ok: true, result: { send: { accepted: true } } }
      : { ok: true, result: { terminal: { source: 'screen', tail: empty.lines, draft: empty.draft } } }
  )
  const onError = vi.fn()
  const removePending = vi.fn()
  let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
  function Harness() {
    api = useMobileNativeChatQueueEditor({
      agent: 'claude',
      tabId: 'tab',
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'phone' },
      client: { sendRequest } as unknown as RpcClient,
      enabled: true,
      beforeOpen: async () => undefined,
      pending: [{ id: 'pending-outbox-send-1', text: CLAUDE_QUEUED_TEXT }],
      removePending,
      onError
    })
    return null
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await act(async () => {
    const opening = api.open(0, CLAUDE_QUEUED_TEXT)
    await vi.runAllTimersAsync()
    await opening
  })
  expect(onError).toHaveBeenCalledExactlyOnceWith('That message is no longer queued.')
  expect(sendRequest.mock.calls.some(([method]) => method === 'terminal.send')).toBe(false)
  expect(api.editor).toBeNull()
  expect(phoneQueueRecallsForTests()).toEqual([])
  expect(removePending).not.toHaveBeenCalled()
  await act(async () => renderer.unmount())
})
