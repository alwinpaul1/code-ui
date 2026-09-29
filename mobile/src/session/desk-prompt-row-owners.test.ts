// Whose row a user row of a desk prompt's words is, by the prompt hook's own
// copies of each submission (gap D of the final review of
// fix/midturn-prompt-at-end). The overlay cases are in
// mobile-chat-midturn-beacon-evidence.test.ts.
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { ownedByLaterSubmission, rowOwners, witnessRowsNotItsOwn } from './desk-prompt-row-owners'
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
  it('is the latest hook submission of its words typed before it', () => {
    const owners = rowOwners([midTurn, nextTurn], rows, words)
    expect(owners.get('u4')).toEqual({ nonce: '502', position: 2, arrival: 200_000 })
  })

  it('is the status copy’s, by its hook copy, when that is the latest', () => {
    expect(rowOwners([midTurn], rows, words).get('u4')).toEqual({ nonce: 'status:s:1:0', position: 0, arrival: 1_000 })
  })

  it('is no one’s with no hook copy, a row it names that is not held, or a row before every submission', () => {
    expect(rowOwners([{ ...midTurn, hookTwin: undefined }], rows, words).size).toBe(0)
    expect(rowOwners([{ ...nextTurn, anchorId: 'gone' }], rows, words).size).toBe(0)
    const early = [row('u0', 'user', 'go on'), ...rows]
    expect(rowOwners([nextTurn], early, words).has('u0')).toBe(false)
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
