// Whose row a user row of a desk prompt's words is, by the prompt hook's own
// copies of each submission (gap D of the final review of
// fix/midturn-prompt-at-end). The overlay cases are in
// mobile-chat-midturn-beacon-evidence.test.ts.
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { joinedLineBetween, ownedByLaterSubmission, rowOwners, witnessRowsNotItsOwn } from './desk-prompt-row-owners'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import { landedKey } from './use-desktop-prompt-echoes'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const words = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')
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

// The review of d147a9c4 (D1): a row between a copy and a later row of its
// words, carrying the copy's words as a run of whole lines of it, may be the
// copy's own (Claude dequeued it with another as one row, a line apart).
describe('a joined row between a copy and a later row of its words', () => {
  const none = new Map()
  const between = [row('a1', 'assistant', 'one'), row('u2', 'user', 'go on\nand the rest'), row('a3', 'assistant', 'ok'), row('u4', 'user', 'go on')]

  it('is found when a run of its lines is the copy’s words, one line or several', () => {
    expect(joinedLineBetween(between, 0, 3, 'go on', words, none)).toBe(true)
    const several = [row('a1', 'assistant', 'one'), row('u2', 'user', 'go on\n\nand then stop\nthe rest'), row('u4', 'user', 'go on and then stop')]
    expect(joinedLineBetween(several, 0, 2, 'go on and then stop', words, none)).toBe(true)
    // A run that starts like the words and parts from them, then the words.
    const falseStart = [row('a1', 'assistant', 'one'), row('u2', 'user', 'go on\nand stop\ngo on\nand then stop'), row('u4', 'user', 'go on and then stop')]
    expect(joinedLineBetween(falseStart, 0, 2, 'go on and then stop', words, none)).toBe(true)
  })

  // A prompt that merely has the words inside a line, the whole row (the
  // copy's own row, landed as it is), one its own hook copy owns and a
  // harness row (the review of b6e83243, G1), a row outside the span, or a
  // copy with no place: none is.
  it('is not a line that only contains the words, the whole row, an owned row, a harness row, a row outside the span, or anything with no place', () => {
    const inline = [row('a1', 'assistant', 'one'), row('u2', 'user', 'ok go on\nand the rest'), row('u4', 'user', 'go on')]
    expect(joinedLineBetween(inline, 0, 2, 'go on', words, none)).toBe(false)
    const whole = [row('a1', 'assistant', 'one'), row('u2', 'user', 'go on\nand the rest'), row('u4', 'user', 'go on and the rest')]
    expect(joinedLineBetween(whole, 0, 2, 'go on and the rest', words, none)).toBe(false)
    expect(joinedLineBetween(between, 0, 3, 'go on', words, new Map([['u2', { nonce: '7', position: 0, arrival: 1 }]]))).toBe(false)
    const notice = [row('a1', 'assistant', 'one'), row('u2', 'user', '<task-notification>\ngo on\n</task-notification>'), row('u4', 'user', 'go on')]
    expect(joinedLineBetween(notice, 0, 2, 'go on', words, none)).toBe(false)
    expect(joinedLineBetween(between, 2, 3, 'go on', words, none)).toBe(false)
    expect(joinedLineBetween(between, undefined, 3, 'go on', words, none)).toBe(false)
  })

  // Read with the chat's own key, the copy's words as the start of a later
  // line: the run's key reads them where they follow other text, so a rule
  // that acts only at the start of a text (a plugin skill token, a pasted
  // photo's path) must not shorten them there (the review of 96160b44, A1).
  for (const [label, copy] of [
    ['a later line that starts with a plugin skill token', 'please check this flake\n/codex:rescue look at the retry loop'],
    ['a later line that starts with a pasted photo path', 'compare the two screens\n/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1790405916218-5211776c-2f4a-4164-bbdf-ed7c7adc9c20.png is the new one'],
    ['a later line that starts with a photo marker', 'compare the two screens\n[Image #4] is the new one'],
    ['paste tags on lines of their own', 'look at this\n<pasted_content id="329c">\nFind me the flake\n</pasted_content id="329c">\nthanks'],
    ['backticks across lines', 'run `npm\ntest` again'],
    ['a first line that is a plugin skill token', '/codex:rescue look at the retry loop\nand the flake']
  ] as const) {
    it(`is found with the chat’s key when the copy has ${label}`, () => {
      const rows = [row('a1', 'assistant', 'one'), row('u2', 'user', `${copy}\nsecond queued thing to look at`), row('u4', 'user', copy)]
      expect(joinedLineBetween(rows, 0, 2, landedKey(copy), landedKey, none)).toBe(true)
    })
  }

  // Degenerate: no rows between.
  it('is not there with no rows between', () => {
    expect(joinedLineBetween(between, 0, 1, 'go on', words, none)).toBe(false)
    expect(joinedLineBetween([], 0, 0, 'go on', words, none)).toBe(false)
  })
})
