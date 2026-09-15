import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatPendingMessage } from '../session/mobile-native-chat-pending-echo'

// A store whose writes can be held open, so a read can be made to race one.
const store = new Map<string, string>()
let holdWrites: (() => void) | null = null
let writeGate: Promise<void> = Promise.resolve()

function openWriteGate(): void {
  writeGate = new Promise<void>((resolve) => {
    holdWrites = resolve
  })
}

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      await writeGate
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      await writeGate
      store.delete(key)
    }
  }
}))

import {
  readNativeChatPendingEchoes,
  resetNativeChatPendingEchoClocksForTests,
  writeNativeChatPendingEchoes
} from './native-chat-pending-echoes'

function echo(id: string, text: string): MobileNativeChatPendingMessage {
  return {
    id,
    text,
    expectedOccurrence: 1,
    baselineTailMessageId: 'row-1',
    baselineResolved: true
  }
}

/**
 * The store's own stated rule (`native-chat-pending-echoes.ts:54`): "A route can
 * reopen while retirement is still removing its disk entry." Leaving the project
 * and returning re-reads this key, and that read can start while the write
 * retiring the entry is still in flight. Without the barrier the read wins the
 * race and hands back echoes the transcript has already taken over, so the
 * bubbles come back for a beat on the next visit — the duplicate this whole
 * store exists to avoid.
 *
 * Untested until 2026-09-15, found by an invariant audit.
 */
describe('reopening a conversation while its echoes are being retired', () => {
  beforeEach(() => {
    store.clear()
    holdWrites = null
    writeGate = Promise.resolve()
    resetNativeChatPendingEchoClocksForTests()
  })

  it('waits for a retirement write to finish before reading the entry back', async () => {
    await writeNativeChatPendingEchoes('s1', [echo('e1', 'queued message')])
    expect(await readNativeChatPendingEchoes('s1')).toHaveLength(1)

    // Retirement empties the list, which removes the entry — held open here.
    openWriteGate()
    const retiring = writeNativeChatPendingEchoes('s1', [])
    // The route reopens mid-write and reads the same key.
    const reopened = readNativeChatPendingEchoes('s1')
    holdWrites?.()
    await retiring

    // The read must reflect the retirement, not the entry it was deleting.
    expect(await reopened).toBeNull()
  })

  it('reads back a write that is still in flight, rather than the value before it', async () => {
    await writeNativeChatPendingEchoes('s1', [echo('e1', 'first')])

    openWriteGate()
    const writing = writeNativeChatPendingEchoes('s1', [echo('e1', 'first'), echo('e2', 'second')])
    const reopened = readNativeChatPendingEchoes('s1')
    holdWrites?.()
    await writing

    expect((await reopened)?.map((item) => item.id)).toEqual(['e1', 'e2'])
  })

  it('does not hold a read behind a write to a different conversation', async () => {
    await writeNativeChatPendingEchoes('s2', [echo('e9', 'other session')])
    openWriteGate()
    const blocked = writeNativeChatPendingEchoes('s1', [echo('e1', 'mine')])
    // s2's entry is already on disk and its key has no write in flight.
    expect(await readNativeChatPendingEchoes('s2')).toHaveLength(1)
    holdWrites?.()
    await blocked
  })
})
