import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { rebaseMobileNativeChatPendingBaselines } from './mobile-native-chat-pending-baseline'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

function userTurn(id: string, text: string, timestamp: number): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp, source: 'transcript' }
}

function assistantTurn(id: string, text: string, timestamp: number): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

function unresolved(
  id: string,
  text: string,
  expectedOccurrence = 1
): MobileNativeChatPendingMessage {
  return { id, text, expectedOccurrence, baselineTailMessageId: null, baselineResolved: false }
}

describe('rebaseMobileNativeChatPendingBaselines', () => {
  const history = [userTurn('m1', 'run the tests', 1000), assistantTurn('m2', 'passed', 1100)]

  it('returns the same array when every baseline is already resolved', () => {
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: 'hi',
        expectedOccurrence: 1,
        baselineTailMessageId: 'm2',
        baselineResolved: true
      }
    ]
    expect(rebaseMobileNativeChatPendingBaselines(history, pending)).toBe(pending)
  })

  it('gives an unresolved send the loaded tail as its glue boundary', () => {
    expect(
      rebaseMobileNativeChatPendingBaselines(history, [unresolved('p1', 'run the tests')])
    ).toEqual([
      {
        id: 'p1',
        text: 'run the tests',
        // NOT recounted against this read: the read may already carry this send's
        // own echo, and counting it as history would strand the bubble forever.
        expectedOccurrence: 1,
        baselineTailMessageId: 'm2',
        baselineResolved: true
      }
    ])
  })

  it('pins to null when the authoritative transcript is empty', () => {
    expect(rebaseMobileNativeChatPendingBaselines([], [unresolved('p1', 'hi')])).toEqual([
      {
        id: 'p1',
        text: 'hi',
        expectedOccurrence: 1,
        baselineTailMessageId: null,
        baselineResolved: true
      }
    ])
  })

  it('keeps the ordinals the queue already assigned', () => {
    expect(
      rebaseMobileNativeChatPendingBaselines(history, [
        unresolved('p1', 'run the tests', 1),
        unresolved('p2', 'run the tests', 2)
      ]).map((item) => item.expectedOccurrence)
    ).toEqual([1, 2])
  })

  it('leaves already-resolved neighbours untouched', () => {
    const resolved: MobileNativeChatPendingMessage = {
      id: 'p1',
      text: 'run the tests',
      expectedOccurrence: 9,
      baselineTailMessageId: 'm1',
      baselineResolved: true
    }
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [
      resolved,
      unresolved('p2', 'run the tests', 2)
    ])
    expect(rebased[0]).toBe(resolved)
    expect(rebased[1]).toEqual({
      id: 'p2',
      text: 'run the tests',
      expectedOccurrence: 2,
      baselineTailMessageId: 'm2',
      baselineResolved: true
    })
  })

  // An unsettled read still shows this session's own retained history, so a send
  // made across a reconnect already owns a real boundary. Moving it onto the read
  // that follows pushes it past the send's own echo and strands the bubble.
  it('never moves a tail the send actually captured', () => {
    const captured: MobileNativeChatPendingMessage = {
      id: 'p1',
      text: 'run the tests',
      expectedOccurrence: 1,
      baselineTailMessageId: 'm1',
      baselineResolved: false
    }
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [captured])
    expect(rebased[0]?.baselineTailMessageId).toBe('m1')
    expect(rebased[0]?.baselineResolved).toBe(true)
  })

  // An image echo counts image turns AFTER its tail, so moving a real tail onto
  // this read would discard an echo the read already carries.
  it('keeps a caption-less image echo on the tail it actually captured', () => {
    const images = {
      ...unresolved('p1', ''),
      baselineTailMessageId: 'm1',
      images: ['file:///a.png']
    }
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [images])
    expect(rebased[0]?.baselineTailMessageId).toBe('m1')
    expect(rebased[0]?.expectedOccurrence).toBe(1)
    expect(rebased[0]?.baselineResolved).toBe(true)
  })

  // A captioned image echo binds by an ordinal counted over the whole transcript.
  // Pinning a tail without recounting leaves it matching nothing, forever.
  it('leaves a captioned image echo entirely alone', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [
      { ...unresolved('p1', 'here'), images: ['file:///a.png'] }
    ])
    expect(rebased[0]?.baselineTailMessageId).toBe(null)
    expect(rebased[0]?.expectedOccurrence).toBe(1)
    expect(rebased[0]?.baselineResolved).toBe(true)
  })

  // A supplied tail would sit at or after this send's own echo, and an image
  // echo counts turns AFTER its tail — so it would exclude the very row it is
  // waiting for, and image entries have no other retirement path.
  it('never supplies a tail to a caption-less image echo either', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [
      { ...unresolved('p1', ''), images: ['file:///a.png'] },
      { ...unresolved('p2', '', 2), images: ['file:///b.png'] }
    ])
    expect(rebased.map((item) => item.baselineTailMessageId)).toEqual([null, null])
    expect(rebased.map((item) => item.expectedOccurrence)).toEqual([1, 2])
    expect(rebased.every((item) => item.baselineResolved)).toBe(true)
  })

  // Same rule for a text-empty entry with no images: it reconciles by counting
  // image-source turns after its tail, so a supplied tail strands it too.
  it('never supplies a tail to a text-empty entry', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(history, [unresolved('p1', '   ')])
    expect(rebased[0]?.baselineTailMessageId).toBe(null)
    expect(rebased[0]?.baselineResolved).toBe(true)
  })
})

// A read that settles long after the send: the chat was opened mid-turn over a
// re-dialling relay, a message went out, and the rows came back after the turn
// had ended (reported 2026-09-25, Claude Code 2.1.282, session da53d612). Its
// tail is the reply that ended the turn, which the message came before.
describe('a send whose read settled after the replies to it', () => {
  const sentAt = 50_000
  const settledLate = [
    assistantTurn('m1', 'Pushed. Waiting for the deploy…', 10_000),
    assistantTurn('m2', 'The menu opens from the right edge.', 120_000),
    assistantTurn('m3', 'Fixed: the menu opens from the left now.', 250_000)
  ]
  const sent = (text: string, images?: string[]): MobileNativeChatPendingMessage => ({
    ...unresolved('p1', text),
    sentAt,
    ...(images ? { images } : {})
  })

  it('anchors a text send at the last row written before it, not under the reply that ended the turn', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledLate, [sent('check the menu')])
    expect(rebased[0]?.baselineTailMessageId).toBe('m1')
    expect(rebased[0]?.baselineResolved).toBe(true)
  })

  it('draws a photo sent then where it was sent, and still withholds its counted boundary', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledLate, [sent('', ['file:///a.png'])])
    expect(rebased[0]?.placementAnchorId).toBe('m1')
    expect(rebased[0]?.baselineTailMessageId).toBeNull()
  })

  it('leads when every row the read holds was written after the send', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledLate.slice(1), [sent('check the menu')])
    expect(rebased[0]?.baselineTailMessageId).toBeNull()
    expect(rebased[0]?.baselineResolved).toBe(true)
  })

  it('takes the one row a one-row read holds when it came before the send', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledLate.slice(0, 1), [sent('check the menu')])
    expect(rebased[0]?.baselineTailMessageId).toBe('m1')
  })

  // Review, 2026-09-25: the phone's clock margin moved a row written in the
  // second before the send below it, where the old tail rule kept it above.
  it('keeps a row written just before the send above it when the read settles a moment later', () => {
    const justBefore = [assistantTurn('m1', 'first', sentAt - 5000), assistantTurn('m2', 'second', sentAt - 500)]
    expect(
      rebaseMobileNativeChatPendingBaselines(justBefore, [sent('check the menu')])[0]?.baselineTailMessageId
    ).toBe('m2')
  })

  it('keeps rows that carry no time above the send when nothing timed came after it', () => {
    const untimedTail = [
      ...settledLate.slice(0, 1),
      { ...assistantTurn('u1', 'streamed', 0), timestamp: null },
      { ...assistantTurn('u2', 'streamed', 0), timestamp: null }
    ]
    expect(
      rebaseMobileNativeChatPendingBaselines(untimedTail, [sent('check the menu')])[0]?.baselineTailMessageId
    ).toBe('u2')
  })

  it('keeps the old tail rule for a send with no time, or a read whose rows carry none', () => {
    expect(
      rebaseMobileNativeChatPendingBaselines(settledLate, [unresolved('p1', 'check the menu')])[0]
        ?.baselineTailMessageId
    ).toBe('m3')
    const untimed = settledLate.map((message) => ({ ...message, timestamp: null }))
    expect(
      rebaseMobileNativeChatPendingBaselines(untimed, [sent('check the menu')])[0]?.baselineTailMessageId
    ).toBe('m3')
    // The pending store does not check the field it reads back.
    const garbled = { ...sent('check the menu'), sentAt: Number.NaN }
    expect(rebaseMobileNativeChatPendingBaselines(settledLate, [garbled])[0]?.baselineTailMessageId).toBe('m3')
  })
})
