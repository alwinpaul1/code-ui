import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import {
  mobileNativeChatInputResidue,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
afterEach(() => {
  vi.useRealTimers()
  resetMobileNativeChatTerminalWritesForTests()
})

it.each(['claude', 'codex'])(
  'edits a desktop %s queue in chat and sends the saved text',
  async (agent) => {
    vi.useFakeTimers()
    let draft = agent === 'claude' ? 'Press up to edit queued messages' : ''
    let queued = ['original desktop text']
    const isKill = (text: string) =>
      text.length > 0 && [...text].every((char) => char === '\u0015' || char === '\u000b')
    const writes: string[] = []
    const sendRequest = vi.fn(async (method: string, params: { text?: string }) => {
      if (method === 'terminal.send') {
        const text = params.text!
        writes.push(text)
        if (text.includes('\x1b[A') || text === '\x1b[1;3A') {
          draft = 'original desktop text'
          queued = []
        } else if (isKill(text)) {
          draft = ''
        } else if (text.includes('\x1b[200~')) {
          draft = text.split('\x1b[200~')[1]!.split('\x1b[201~')[0]!
          if (text.endsWith('\t') || text.endsWith('\r')) {
            queued = [draft]
            draft = ''
          }
        } else if (text === '\t' || text === '\r') {
          if (draft) {
            queued = [draft]
          }
          draft = ''
        }
        return { ok: true, result: { send: { accepted: true } } }
      }
      return {
        ok: true,
        result: {
          terminal: {
            source: 'screen',
            // Claude paints its queue hint as the placeholder whenever the
            // composer is empty and something is still queued.
            draft:
              agent === 'claude' && !draft && queued.length
                ? 'Press up to edit queued messages'
                : draft,
            tail: queued.length
              ? agent === 'codex'
                ? [
                    '• Queued follow-up inputs',
                    ...queued.map((entry) => `  ↳ ${entry}`),
                    '    ⌥ + ↑ edit last queued message'
                  ]
                : [...queued.map((entry) => `  ❯ ${entry}`), '──────────', '❯', '──────────']
              : ['• Working (1m • esc to interrupt)']
          }
        }
      }
    })
    const client = { sendRequest } as unknown as RpcClient
    const beforeOpen = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const removePending = vi.fn()
    let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
    function Harness() {
      api = useMobileNativeChatQueueEditor({
        agent,
        tabId: 'tab',
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: 'phone' },
        client,
        enabled: true,
        beforeOpen,
        pending: [
          { id: 'earlier-repeat', text: 'original desktop text' },
          { id: 'recalled', text: 'original desktop text' },
          { id: 'another', text: 'other message' }
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
      const opening = api.open()
      await vi.runAllTimersAsync()
      await opening
    })
    expect(beforeOpen).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(api.editor?.text).toBe('original desktop text')
    expect(removePending).toHaveBeenCalledExactlyOnceWith('recalled')
    await act(async () => api.editor!.setText('edited on mobile'))
    await act(async () => {
      const saving = api.editor!.save()
      await vi.runAllTimersAsync()
      await saving
    })
    expect(api.editor).toBeNull()
    expect(writes.some((text) => text.includes('edited on mobile'))).toBe(true)
    expect(writes.at(-1)!.endsWith(agent === 'codex' ? '\t' : '\r')).toBe(true)
    expect(
      sendRequest.mock.calls.every(([method]) =>
        ['terminal.read', 'terminal.send'].includes(method)
      )
    ).toBe(true)
    await act(async () => renderer.unmount())
  }
)

it.each(['tab', 'handle', 'unmount'])(
  'does not recall stale queue input after %s changes',
  async (change) => {
    let settle!: () => void
    const beforeOpen = () =>
      new Promise<void>((resolve) => {
        settle = resolve
      })
    const sendRequest = vi.fn()
    const client = { sendRequest } as unknown as RpcClient
    const handleRef = { current: 'terminal' }
    let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
    function Harness({ tabId = 'tab' }) {
      api = useMobileNativeChatQueueEditor({
        agent: 'codex',
        tabId,
        handleRef,
        deviceTokenRef: { current: 'phone' },
        client,
        enabled: true,
        beforeOpen,
        onError: vi.fn()
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let opening!: Promise<void>
    act(() => {
      opening = api.open()
    })
    await act(async () => {
      if (change === 'tab') {
        renderer.update(createElement(Harness, { tabId: 'other' }))
      }
      if (change === 'handle') {
        handleRef.current = 'other'
      }
      if (change === 'unmount') {
        renderer.unmount()
      }
    })
    await act(async () => {
      settle()
      await opening
    })
    expect(sendRequest).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  }
)


function editorHarness(sendRequest: ReturnType<typeof vi.fn>) {
  const handleRef = { current: 'terminal' as string | null }
  let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
  function Harness() {
    api = useMobileNativeChatQueueEditor({
      agent: 'claude',
      tabId: 'tab',
      handleRef,
      deviceTokenRef: { current: 'phone' },
      client: { sendRequest } as unknown as RpcClient,
      enabled: true,
      beforeOpen: async () => {},
      pending: [],
      removePending: vi.fn(),
      onError: vi.fn()
    })
    return null
  }
  return {
    handleRef,
    Harness,
    get api() {
      return api
    }
  }
}

function claudeQueueReply(queued: readonly string[], draft: string) {
  return {
    ok: true,
    result: {
      terminal: {
        source: 'screen',
        draft: !draft && queued.length ? 'Press up to edit queued messages' : draft,
        tail: queued.length
          ? [...queued.map((entry) => `  ❯ ${entry}`), '───', '❯', '───']
          : ['• Working (1m · esc to interrupt)']
      }
    }
  }
}

it('leaves the next send its ordinary clear when the pencil refused before touching the agent', async () => {
  // The residue marker means "the agent is holding a recalled queue". Most
  // recall refusals never send a key, and marking one anyway made the next
  // phone send fire a forty-line kill burst that wipes what the user had
  // typed on the desktop.
  resetMobileNativeChatStaleInputForTests()
  const sendRequest = vi.fn(async (method: string) =>
    method === 'terminal.send'
      ? { ok: true, result: { send: { accepted: true } } }
      : claudeQueueReply(['only one queued'], '')
  )
  const harness = editorHarness(sendRequest)
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(harness.Harness))
  })
  await act(async () => {
    await harness.api.open(5, 'a message that is no longer queued')
  })
  expect(harness.api.editor).toBeNull()
  expect(sendRequest.mock.calls.some(([method]) => method === 'terminal.send')).toBe(false)
  expect(mobileNativeChatInputResidue('terminal')).toBeNull()
  await act(async () => renderer.unmount())
})

it('marks the residue when the recall failed after its key reached the agent', async () => {
  // The counterpart: Up went out and emptied the queue into the composer, so
  // the next send has to clear all of it however the recall then failed.
  resetMobileNativeChatStaleInputForTests()
  let reads = 0
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'terminal.send') {
      return { ok: true, result: { send: { accepted: true } } }
    }
    reads += 1
    // The queue reads back, Up is sent, and every later read is unusable.
    return reads === 1
      ? claudeQueueReply(['alpha first', 'bravo second'], '')
      : claudeQueueReply([], 'something else entirely')
  })
  const harness = editorHarness(sendRequest)
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(harness.Harness))
  })
  await act(async () => {
    await harness.api.open(0, 'alpha first')
  })
  expect(sendRequest.mock.calls.some(([method]) => method === 'terminal.send')).toBe(true)
  expect(mobileNativeChatInputResidue('terminal')).not.toBeNull()
  resetMobileNativeChatStaleInputForTests()
  await act(async () => renderer.unmount())
})
