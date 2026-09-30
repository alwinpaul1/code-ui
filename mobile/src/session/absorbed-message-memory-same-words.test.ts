import { describe, expect, it } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { echoMemoryId, rememberEchoInPending, sweepWitnessedEchoes } from './mobile-native-chat-remember-echo'
import { witnessesToRemember } from './mobile-native-chat-witness-memory'

// Two messages of the same words queued at the desk mid-turn on a tab without
// the prompt hook ("keep going", twice) are two echoes of the queue box, each
// where the box first listed it. Both were written to the store under one id,
// a hash of the words, and the store keeps one item per id, so only the first
// was remembered: after a tab switch, a reconnect or a relaunch the chat
// restored one bubble and the other was gone (review, 2026-09-30). Each is
// now remembered where the box first listed it (`absorbed-…@<row>`); a
// message the box already listed when the chat first read it may be one
// remembered before, at another row, and is remembered by its words alone.

const WORDS = 'keep going'
let seq = 0
function echo(text: string, anchor: string, over: Partial<MobileNativeChatPendingMessage> = {}): MobileNativeChatPendingMessage {
  seq += 1
  return { id: `queued-${seq}`, text, expectedOccurrence: 0, baselineTailMessageId: anchor, baselineResolved: true, ...over }
}
/** Each echo remembered in turn, as useRememberedWitnesses does, onto `from`. */
function remember(echoes: readonly MobileNativeChatPendingMessage[], from: MobileNativeChatPendingMessage[] = []) {
  let store: Record<string, MobileNativeChatPendingMessage[]> = { k: from }
  for (const witness of witnessesToRemember(echoes)) {
    store = rememberEchoInPending(store, 'k', witness.id, witness.text, witness.anchorId, [], 'draft', 1000)
  }
  return store.k ?? []
}
/** An item a build before per-row ids stored: its words' hash alone. */
function storedByWords(text: string, anchor: string): MobileNativeChatPendingMessage {
  return { id: echoMemoryId(text), text, expectedOccurrence: 0, baselineTailMessageId: anchor, baselineResolved: true, witnessedAt: 500 }
}

describe('two desk messages of the same words the queue box let go of', () => {
  it('are both remembered, each where the box first listed it', () => {
    const stored = remember([echo(WORDS, 'a1'), echo(WORDS, 'a2')])
    expect(stored.map((item) => item.baselineTailMessageId)).toEqual(['a1', 'a2'])
    expect(new Set(stored.map((item) => item.id)).size).toBe(2)
  })

  it('both come back from the store after a relaunch, in order', () => {
    const stored = remember([echo(WORDS, 'a1'), echo(WORDS, 'a2')])
    expect(sweepWitnessedEchoes(stored).map((item) => item.baselineTailMessageId)).toEqual(['a1', 'a2'])
  })

  // Each waits for a row of its own, as two phone sends of the same words do:
  // one later row of the words retires the first, not both.
  it('each wait for a row of their own', () => {
    expect(remember([echo(WORDS, 'a1'), echo(WORDS, 'a2')]).map((item) => item.expectedOccurrence)).toEqual([1, 2])
  })

  it('keep a later message beside the one an earlier build stored by its words', () => {
    const stored = remember([echo(WORDS, 'a2')], [storedByWords(WORDS, 'a1')])
    expect(stored.map((item) => item.baselineTailMessageId)).toEqual(['a1', 'a2'])
    expect(sweepWitnessedEchoes(stored)).toHaveLength(2)
  })
})

describe('one desk message the queue box let go of', () => {
  it('is remembered once however often it is read', () => {
    expect(remember([echo(WORDS, 'a1'), echo(WORDS, 'a1')]).map((item) => item.baselineTailMessageId)).toEqual(['a1'])
  })

  // The rule the words-only ids had at one row holds at a row too: a reading
  // with the screen's rows glued on is the clean one's message, whichever came
  // first (mobile-native-chat-remember-echo.test.ts pins it by the words).
  it('is remembered once, clean, when a reading of it has rows glued on at its row', () => {
    const clean = 'please check the logs'
    const glued = 'please check the logs Running 1 shell command'
    const first = remember([echo(clean, 'a1')])
    expect(remember([echo(glued, 'a1')], first).map((item) => item.text)).toEqual([clean])
    expect(remember([echo(clean, 'a1')], remember([echo(glued, 'a1')])).map((item) => item.text)).toEqual([clean])
  })

  // Degenerate: one echo, and none.
  it('is remembered once, and nothing is for no echo', () => {
    expect(remember([echo(WORDS, 'a1')])).toHaveLength(1)
    expect(remember([])).toEqual([])
  })

  // The upgrade: an earlier build stored it by its words alone, and the chat
  // reads it again at its first look at the box, at a later row.
  it('is not doubled when the chat first reads again one an earlier build stored', () => {
    const stored = remember([echo(WORDS, 'a5', { listedAtFirstRead: true })], [storedByWords(WORDS, 'a1')])
    expect(stored.map((item) => [item.id, item.baselineTailMessageId])).toEqual([[echoMemoryId(WORDS), 'a1']])
    expect(sweepWitnessedEchoes(stored)).toHaveLength(1)
  })

  // A remount: this build stored it where the box first listed it, and the
  // chat's first read after coming back lists it again, at a later row.
  it('is not doubled when the chat first reads again one it stored before a remount', () => {
    const before = remember([echo(WORDS, 'a1')])
    const after = remember([echo(WORDS, 'a5', { listedAtFirstRead: true })], before)
    expect(after.map((item) => item.baselineTailMessageId)).toEqual(['a1'])
  })
})
