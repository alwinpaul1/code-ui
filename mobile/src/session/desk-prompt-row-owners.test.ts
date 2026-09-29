// Whose row a user row of a desk prompt's words is, by the prompt hook's own
// copies of each submission (gap D of the final review of
// fix/midturn-prompt-at-end). The overlay cases are in
// mobile-chat-midturn-beacon-evidence.test.ts.
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { keysInJoinedRows, ownedByLaterSubmission, rowOwners, witnessRowsNotItsOwn } from './desk-prompt-row-owners'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const words = (text: string) => text.trim().toLowerCase()
const row = (id: string, role: 'user' | 'assistant', text: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: 1,
  source: 'transcript'
})
/** Turn 1 (a1, a2), the reply that ends it (a3), and the same words typed as
 *  turn 2's prompt (u4). */
const rows = [row('a1', 'assistant', 'one'), row('a2', 'assistant', 'two'), row('a3', 'assistant', 'done'), row('u4', 'user', 'go on')]
const midTurn: DesktopPrompt = { nonce: 'status:s:1:0', text: 'go on', at: 10, seenAt: 1_000, hookTwin: { nonce: '501', anchorId: 'a1', seenAt: 1_000 } }
const nextTurn: DesktopPrompt = { nonce: '502', text: 'go on', anchorId: 'a3', seenAt: 200_000 }

describe('whose row a user row of desk words is', () => {
  it('is the hook submission typed straight after the row before it', () => {
    const owners = rowOwners([midTurn, nextTurn], rows, words)
    expect(owners.get('u4')).toEqual({ nonce: '502', position: 2, arrival: 200_000 })
    // The status copy's hook copy, the same way.
    const twin: DesktopPrompt = { ...midTurn, hookTwin: { nonce: '501', anchorId: 'a3', seenAt: 1_000 } }
    expect(rowOwners([twin], rows, words).get('u4')).toEqual({ nonce: 'status:s:1:0', position: 2, arrival: 1_000 })
  })

  it('is no one’s with no hook copy, a row it names that is not held, or a row before every submission', () => {
    expect(rowOwners([{ ...nextTurn, anchorId: undefined }], rows, words).size).toBe(0)
    expect(rowOwners([{ ...nextTurn, anchorId: 'gone' }], rows, words).size).toBe(0)
    const early = [row('u0', 'user', 'go on'), ...rows]
    expect(rowOwners([nextTurn], early, words).has('u0')).toBe(false)
  })

  // Review of 099b7eb0: a message queued mid-turn gets its row when Claude
  // dequeues it at the turn's end, rows after the text it was typed after.
  // Given to the latest submission typed before it, the first of two queued
  // messages of the same words was held off its own row for good.
  it('is no one’s when rows came between it and the row the submission names', () => {
    const queued = [row('a1', 'assistant', 'one'), row('a2', 'assistant', 'two'), row('u3', 'user', 'go on'), row('a4', 'assistant', 'ok'), row('u5', 'user', 'go on')]
    const owners = rowOwners([midTurn, { ...nextTurn, anchorId: 'a1' }], queued, words)
    expect(owners.size).toBe(0)
  })

  // Degenerate: nothing to go by.
  it('is no one’s with no prompts, and with no rows', () => {
    expect(rowOwners([], rows, words).size).toBe(0)
    expect(rowOwners([midTurn, nextTurn], [], words).size).toBe(0)
  })
})

describe('a row a later submission owns', () => {
  const owner = { nonce: '502', position: 2, arrival: 200_000 }

  it('is not an earlier copy’s: one that reached the phone long before it, typed before the row it names', () => {
    expect(ownedByLaterSubmission(owner, { nonce: 'status:s:1:0', position: 0, arrival: 1_000 })).toBe(true)
  })

  // The same submission's two copies a moment apart, or a status copy whose
  // hook copy reached the phone late: the row is the copy's as before.
  it('is still the copy’s when their arrivals are within 30 s, it was typed as late, or either is unknown', () => {
    expect(ownedByLaterSubmission(owner, { nonce: 'x', position: 0, arrival: 200_000 - 30_000 })).toBe(false)
    expect(ownedByLaterSubmission(owner, { nonce: 'x', position: 2, arrival: 1_000 })).toBe(false)
    expect(ownedByLaterSubmission(owner, { nonce: 'x', position: undefined, arrival: 1_000 })).toBe(false)
    expect(ownedByLaterSubmission(owner, { nonce: 'x', position: 0, arrival: undefined })).toBe(false)
    expect(ownedByLaterSubmission({ ...owner, arrival: undefined }, { nonce: 'x', position: 0, arrival: 1_000 })).toBe(false)
    expect(ownedByLaterSubmission(owner, { nonce: '502', position: 0, arrival: 1_000 })).toBe(false)
    expect(ownedByLaterSubmission(undefined, { nonce: 'x', position: 0, arrival: 1_000 })).toBe(false)
  })
})

describe('a witnessed message and the next turn’s prompt of its words', () => {
  const witness: MobileNativeChatPendingMessage = {
    id: 'desk-status:s:1:0',
    text: 'go on',
    expectedOccurrence: 1,
    baselineTailMessageId: 'a1',
    baselineResolved: true,
    witnessedAt: 1_000
  }

  it('is not retired by that row, and remembers so once the hook copies are gone', () => {
    const kept = retireLandedMobileNativeChatPending(rows, [witness], new Set(), [midTurn, nextTurn])
    expect(kept).toEqual([{ ...witness, notItsRows: ['u4'] }])
    expect(retireLandedMobileNativeChatPending(rows, kept, new Set(), [])).toEqual(kept)
  })

  // The guard: the same row with no later submission is the message's own,
  // Claude's row for it dequeued at the turn's end, and retires it.
  it('is retired by the row of its words with no later submission, and a phone send is never held this way', () => {
    expect(retireLandedMobileNativeChatPending(rows, [witness], new Set(), [midTurn])).toEqual([])
    const send = { ...witness, id: 'pending-1', witnessedAt: undefined, sentAt: 1_000 }
    expect(witnessRowsNotItsOwn(rows, [send], [midTurn, nextTurn]).size).toBe(0)
  })

  // Degenerate: an empty store, and a witness from a build that kept no time.
  it('holds nothing for an empty store or a witness with no time', () => {
    expect(witnessRowsNotItsOwn(rows, [], [midTurn, nextTurn]).size).toBe(0)
    expect(witnessRowsNotItsOwn(rows, [{ ...witness, witnessedAt: undefined }], [midTurn, nextTurn]).size).toBe(0)
  })
})

// Two queued messages Claude dequeued as one row, a line apart (the review of
// d147a9c4): that row is each of theirs, on the prompt hook's evidence.
describe('a row made of queued messages joined', () => {
  const copy = (nonce: string, text: string, anchorId: string): DesktopPrompt => ({ nonce, text, anchorId, seenAt: 1_000 })
  const joined = [row('a1', 'assistant', 'one'), row('a2', 'assistant', 'two'), row('a3', 'assistant', 'done'), row('u4', 'user', 'look at x look at y')]

  it('is each of theirs, by the last such row', () => {
    const out = keysInJoinedRows([copy('1', 'look at x', 'a1'), copy('2', 'look at y', 'a2')], joined, words, (message) => words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')))
    expect([...out]).toEqual([['look at x', 3], ['look at y', 3]])
  })

  // The review of c3844d00 (J1): a prompt typed idle, made of earlier
  // messages' words, is its own row; and a part that is only a copy of the
  // tab status, with no hook copy, is no evidence.
  it('is no one’s when a submission of its own words came straight before it, or a part has no hook copy', () => {
    const rowKey = (message: NativeChatMessage) => words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''))
    const own = copy('3', 'look at x look at y', 'a3')
    expect(keysInJoinedRows([copy('1', 'look at x', 'a1'), copy('2', 'look at y', 'a2'), own], joined, words, rowKey).size).toBe(0)
    const statusOnly: DesktopPrompt = { nonce: 'status:s:1:0', text: 'look at x', at: 1 }
    expect(keysInJoinedRows([statusOnly, copy('2', 'look at y', 'a2')], joined, words, rowKey).size).toBe(0)
  })

  // A prompt that only quotes one of them, or one message alone, is no join.
  it('is no one’s when it only quotes one of them, or holds one alone', () => {
    const rowKey = (message: NativeChatMessage) => words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''))
    const quotes = [row('a1', 'assistant', 'one'), row('u2', 'user', 'please look at x first'), row('u3', 'user', 'look at x'), row('u4', 'user', 'look at x look at y and more')]
    expect(keysInJoinedRows([copy('1', 'look at x', 'a1'), copy('2', 'look at y', 'a1')], quotes, words, rowKey).size).toBe(0)
  })

  // The review of c3844d00 (S1): words that overlap made a row that almost
  // splits cost twice as much for every repeat, on the render path. Measured
  // before the fix: 20 repeats took 106 ms, doubling with each.
  it('decides a row of overlapping words quickly however long it is', () => {
    const rowKey = (message: NativeChatMessage) => words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''))
    const long = [row('a1', 'assistant', 'one'), row('u2', 'user', `${Array.from({ length: 25 }, () => 'yes do it').join(' ')} now`)]
    const started = performance.now()
    expect(keysInJoinedRows([copy('1', 'yes', 'a1'), copy('2', 'do it', 'a1'), copy('3', 'yes do it', 'a1')], long, words, rowKey).size).toBe(0)
    expect(performance.now() - started).toBeLessThan(250)
  })

  // Degenerate: one copy's words, no copies, no rows.
  it('is nothing with fewer than two copies’ words or no rows', () => {
    const rowKey = (message: NativeChatMessage) => words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''))
    expect(keysInJoinedRows([copy('1', 'look at x', 'a1')], joined, words, rowKey).size).toBe(0)
    expect(keysInJoinedRows([], joined, words, rowKey).size).toBe(0)
    expect(keysInJoinedRows([copy('1', 'a', 'a1'), copy('2', 'b', 'a1')], [], words, rowKey).size).toBe(0)
  })
})
