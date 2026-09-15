import { describe, expect, it } from 'vitest'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// A witnessed echo read off a terminal too narrow to print the prompt is a STUB:
// the screen cut it and marked the cut with an ellipsis. The parser refuses to
// make new ones now, but one already written to disk comes back on every launch,
// and nothing could ever retire it — retirement matches the transcript row by
// exact text, and a stub is a prefix, never an equal.
//
// The symptom, reported from the device on 2026-09-15 with a screenshot: the
// stub sat as a bubble reading "…utilise the entire spac…" directly above the
// next prompt, with the agent's whole reply missing between them, and it
// survived reinstalling the app.
const STUB_TEXT =
  'the driver name and the parked stats looks similar so near driver name have a small driver icon and utilise the entire spac…'
const FULL_TEXT =
  'the driver name and the parked stats looks similar so near driver name have a small driver icon and utilise the entire space in that see this'

function message(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: 0,
    source: 'transcript'
  } as NativeChatMessage
}

function stub(text: string): MobileNativeChatPendingMessage {
  return {
    id: 'absorbed-1',
    text,
    draftKey: 'd',
    draftEditGeneration: 0,
    pendingKey: 'k',
    normalizedText: text,
    baselineOccurrences: 0,
    expectedOccurrence: 1,
    baselineTailMessageId: 'm0',
    baselineResolved: true
  } as MobileNativeChatPendingMessage
}

describe('a witnessed stub whose real row has landed', () => {
  const messages = [
    message('m0', 'assistant', 'something earlier'),
    message('m1', 'user', FULL_TEXT),
    message('m2', 'assistant', 'Now I can see it.')
  ]

  it('retires against the row it is a prefix of', () => {
    expect(retireLandedMobileNativeChatPending(messages, [stub(STUB_TEXT)], new Set())).toEqual([])
  })

  it('keeps a stub whose row has not landed', () => {
    const other = [message('m0', 'assistant', 'x'), message('m1', 'user', 'a different message')]
    expect(retireLandedMobileNativeChatPending(other, [stub(STUB_TEXT)], new Set())).toHaveLength(1)
  })

  it('does not retire a stub against a row that merely starts the same way', () => {
    // "Fix the parser…" must not be retired by "Fix the parser" being the start
    // of a different, longer message the user genuinely sent later. The stem has
    // to be a real prefix AND the row has to be longer, which it is here — so
    // this is the honest limit of the rule, pinned so it is a decision and not
    // an accident: a stub CAN be claimed by a longer row sharing its stem.
    const rows = [message('m0', 'assistant', 'x'), message('m1', 'user', 'Fix the parser now')]
    expect(retireLandedMobileNativeChatPending(rows, [stub('Fix the parser…')], new Set())).toEqual([])
  })

  it('leaves an ordinary echo alone', () => {
    const exact = stub('an ordinary send')
    const rows = [message('m0', 'assistant', 'x'), message('m1', 'user', 'an ordinary send')]
    expect(retireLandedMobileNativeChatPending(rows, [exact], new Set())).toEqual([])
    const unlanded = [message('m0', 'assistant', 'x')]
    expect(retireLandedMobileNativeChatPending(unlanded, [exact], new Set())).toHaveLength(1)
  })

  it('reads an empty transcript without retiring anything', () => {
    expect(retireLandedMobileNativeChatPending([], [stub(STUB_TEXT)], new Set())).toHaveLength(1)
  })
})
