import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { CLAUDE_SEND_NOW_BYTES } from './claude-send-queue-now'
import {
  acquireMobileNativeChatTerminalWriteForSend,
  releaseMobileNativeChatTerminalWriteForSend,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import {
  NAMED_RULES,
  queuedScreen2_1_285,
  takenScreen2_1_285
} from './fixtures/claude-queued-named-rule-2.1.285'
import {
  SEND_NOW_TYPING_WAIT_MS,
  SEND_NOW_CHAT_MOVED_REFUSAL,
  SEND_NOW_WHILE_TYPING_REFUSAL
} from './claude-send-now-press'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'

/**
 * "when a message is queued had to click multiple times to get that send now
 * done" (2026-10-14).
 *
 * A message sent mid-turn is drawn in the queue box, with "Send now" over it,
 * the moment the composer empties (use-queued-own-sends.ts) — BEFORE its words
 * and Enter are typed into Claude (showSendingEcho runs ahead of writeChatSend
 * in use-mobile-native-chat-message-send.ts). Over the relay that typing takes
 * a round trip or two. A tap in that window pressed ctrl+x ctrl+s into a Claude
 * whose queue was still empty, and Claude Code 2.1.296 drops the key then
 * without a word (its send-now handler returns "nothing_to_send" when the
 * queue holds no prompt). The message then arrived, queued, and only the NEXT
 * tap sent it.
 *
 * The fake agent below holds only that one rule: the key sends what is queued,
 * and does nothing over an empty queue. The screens are the 2.1.285 fixture's
 * (the queued row and its send-now hint, and the same turn with nothing queued).
 */
type Claude = { queue: string[]; sentNow: string[]; droppedKeys: number }

function host(claude: Claude) {
  const keys: number[] = []
  const rpc = {
    getState: () => 'connected',
    sendRequest: vi.fn(async (method: string, params: { text?: string }) => {
      if (method === 'terminal.read') {
        const lines = claude.queue.length
          ? queuedScreen2_1_285(NAMED_RULES.captured1152)
          : takenScreen2_1_285(NAMED_RULES.captured1152)
        return { ok: true, result: { terminal: { lines, source: 'screen' } } }
      }
      if (method === 'terminal.send' && params.text === CLAUDE_SEND_NOW_BYTES) {
        keys.push(Date.now())
        if (claude.queue.length === 0) {
          claude.droppedKeys += 1
        } else {
          claude.sentNow.push(...claude.queue.splice(0))
        }
      }
      return { ok: true, result: { send: { handle: 'term', accepted: true, bytesWritten: 2 } } }
    })
  }
  return { rpc: rpc as unknown as RpcClient, keys }
}

describe('Send now on a message that is still being typed into Claude', () => {
  let renderer: ReactTestRenderer | null = null
  let queue: ReturnType<typeof useMobileNativeChatQueueEditor> | null = null
  let onError = vi.fn()

  beforeEach(() => {
    onError = vi.fn()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    queue = null
    vi.useRealTimers()
    resetMobileNativeChatTerminalWritesForTests()
  })

  async function mount(client: RpcClient, handleRef: { current: string | null } = { current: 'term' }): Promise<void> {
    function Harness(): null {
      queue = useMobileNativeChatQueueEditor({
        agent: 'claude',
        tabId: 'tab',
        handleRef,
        deviceTokenRef: { current: 'phone' },
        client,
        enabled: true,
        beforeOpen: async () => undefined,
        onError,
        pending: [],
        removePending: vi.fn(),
        queued: []
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  /** The composer's send owns the terminal from before its bubble is queued
   *  until its words and Enter are written (sendFollowingTheTab). */
  function composerStartsTyping(): void {
    expect(acquireMobileNativeChatTerminalWriteForSend('term')).not.toBeNull()
  }
  /** Over the relay the composer's clear, words and Enter take longer than the
   *  tap's one look at the screen: every reply here is a microtask, so one
   *  macrotask lets the tap do all it would do before the typing ends. */
  async function typingOutlastsTheScreenRead(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  function composerFinishesTyping(claude: Claude, words: string): void {
    claude.queue.push(words)
    releaseMobileNativeChatTerminalWriteForSend('term')
  }

  // Degenerate size: the one queued message is the one still being typed.
  it('sends a queued message on the first tap of Send now while its words are still being typed', async () => {
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc } = host(claude)
    await mount(rpc)
    composerStartsTyping()

    let tap!: Promise<boolean>
    act(() => {
      tap = queue!.sendNow()
    })
    await act(async () => {
      await typingOutlastsTheScreenRead()
      composerFinishesTyping(claude, 'fix the build first')
    })
    let sent: boolean | undefined
    await act(async () => {
      sent = await tap
    })

    expect(claude.droppedKeys).toBe(0)
    expect(claude.sentNow).toEqual(['fix the build first'])
    expect(sent).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  // The entry leaves the queue mid-tap: Claude takes it on its own (its turn
  // ended) while the tap waits. The key then lands on an empty queue, which
  // Claude ignores; one key, no error, nothing typed twice.
  it('presses the key once and says nothing when Claude takes the message itself mid-tap', async () => {
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc, keys } = host(claude)
    await mount(rpc)
    composerStartsTyping()

    let tap!: Promise<boolean>
    act(() => {
      tap = queue!.sendNow()
    })
    await act(async () => {
      await typingOutlastsTheScreenRead()
      composerFinishesTyping(claude, 'fix the build first')
      claude.queue.splice(0)
    })
    await act(async () => {
      await tap
    })

    expect(keys).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  // Failure path: the typing never finishes (a send stuck on a dead relay).
  // The key is not pressed blind, and the line it leaves says why.
  it('says why and presses nothing when the message is still being typed after the wait', async () => {
    vi.useFakeTimers()
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc, keys } = host(claude)
    await mount(rpc)
    composerStartsTyping()

    let sent: boolean | undefined
    act(() => {
      void queue!.sendNow().then((value) => {
        sent = value
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEND_NOW_TYPING_WAIT_MS + 1)
    })

    expect(sent).toBe(false)
    expect(keys).toEqual([])
    expect(onError).toHaveBeenCalledExactlyOnceWith(SEND_NOW_WHILE_TYPING_REFUSAL)
  })

  // A second tap while the first is still waiting joins it: one key.
  it('presses the key once for two quick taps while the message is still being typed', async () => {
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc, keys } = host(claude)
    await mount(rpc)
    composerStartsTyping()

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = queue!.sendNow()
      second = queue!.sendNow()
    })
    await act(async () => {
      await typingOutlastsTheScreenRead()
      composerFinishesTyping(claude, 'fix the build first')
    })
    let results: boolean[] = []
    await act(async () => {
      results = await Promise.all([first, second])
    })

    expect(keys).toHaveLength(1)
    expect(results).toEqual([true, true])
    expect(claude.sentNow).toEqual(['fix the build first'])
    expect(onError).not.toHaveBeenCalled()
  })

  // Failure path: the chat moved to another terminal while the tap waited. The
  // key is not pressed into a terminal the tap was not made on.
  it('says why and presses nothing when the chat moves to another terminal mid-tap', async () => {
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc, keys } = host(claude)
    const handleRef = { current: 'term' as string | null }
    await mount(rpc, handleRef)
    composerStartsTyping()

    let tap!: Promise<boolean>
    act(() => {
      tap = queue!.sendNow()
    })
    await act(async () => {
      await typingOutlastsTheScreenRead()
      handleRef.current = 'other-term'
      composerFinishesTyping(claude, 'fix the build first')
    })
    let sent: boolean | undefined
    await act(async () => {
      sent = await tap
    })

    expect(sent).toBe(false)
    expect(keys).toEqual([])
    expect(onError).toHaveBeenCalledExactlyOnceWith(SEND_NOW_CHAT_MOVED_REFUSAL)
  })

  // A second composer send takes the terminal during the tap's look at the
  // screen: the key waits for that one too, or it lands over a message Claude
  // does not hold yet.
  it('waits again when another message starts typing during the look at the screen', async () => {
    const claude: Claude = { queue: [], sentNow: [], droppedKeys: 0 }
    const { rpc } = host(claude)
    const read = rpc.sendRequest as unknown as ReturnType<typeof vi.fn>
    const answer = read.getMockImplementation()!
    let retaken = false
    read.mockImplementation(async (method: string, params: { text?: string }) => {
      if (method === 'terminal.read' && !retaken) {
        retaken = true
        composerStartsTyping()
      }
      return answer(method, params)
    })
    await mount(rpc)

    let tap!: Promise<boolean>
    act(() => {
      tap = queue!.sendNow()
    })
    await act(async () => {
      await typingOutlastsTheScreenRead()
      composerFinishesTyping(claude, 'and the second one')
    })
    let sent: boolean | undefined
    await act(async () => {
      sent = await tap
    })

    expect(claude.droppedKeys).toBe(0)
    expect(claude.sentNow).toEqual(['and the second one'])
    expect(sent).toBe(true)
  })

  // Unchanged: nothing being typed, the key goes at once.
  it('presses the key at once when nothing is being typed', async () => {
    const claude: Claude = { queue: ['already queued'], sentNow: [], droppedKeys: 0 }
    const { rpc } = host(claude)
    await mount(rpc)
    let sent: boolean | undefined
    await act(async () => {
      sent = await queue!.sendNow()
    })
    expect(sent).toBe(true)
    expect(claude.sentNow).toEqual(['already queued'])
  })
})
