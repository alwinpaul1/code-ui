import { describe, expect, it } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { echoMemoryId } from './mobile-native-chat-remember-echo'
import { witnessesToRemember } from './mobile-native-chat-witness-memory'

function witness(
  over: Partial<MobileNativeChatPendingMessage> & { id: string; text: string }
): MobileNativeChatPendingMessage {
  return {
    expectedOccurrence: 1,
    baselineTailMessageId: 'row-1',
    baselineResolved: true,
    ...over
  }
}

describe('which witnessed messages are written to disk', () => {
  // The first reading of a session is a BACKLOG, not an event stream, so the
  // absorbed-queue path holds the newest unlanded prompt only as a guess. Wri-
  // ting a guess makes it permanent: that is the bug where the whole backlog
  // came back as stacked bubbles with no replies between them (2026-09-13).
  it('never writes a prompt that is still only a guess', () => {
    expect(
      witnessesToRemember([
        witness({ id: 'absorbed-1', text: 'a guess from the first screen', provisional: true })
      ])
    ).toEqual([])
  })

  it('writes it once the reading is no longer a guess', () => {
    const remembered = witnessesToRemember([
      witness({ id: 'absorbed-1', text: 'seen leaving the queue' })
    ])
    expect(remembered).toEqual([
      { id: echoMemoryId('seen leaving the queue'), text: 'seen leaving the queue', anchorId: 'row-1' }
    ])
  })

  // A restored echo with no boundary must never come back as a new send, so an
  // echo with no anchor has nothing worth storing.
  it('never writes an echo with no anchor to be restored into', () => {
    expect(
      witnessesToRemember([
        witness({ id: 'absorbed-1', text: 'no anchor yet', baselineTailMessageId: null })
      ])
    ).toEqual([])
  })

  // A desktop prompt keeps its own id, so repeated beacons of ONE prompt map to
  // one entry rather than accumulating.
  it('keeps a desktop prompt under its own id, not a hash of its text', () => {
    expect(witnessesToRemember([witness({ id: 'desk-n1', text: 'typed on the desktop' })])).toEqual([
      { id: 'desk-n1', text: 'typed on the desktop', anchorId: 'row-1' }
    ])
  })

  // An absorbed reading has no stable identity but its words, so the same
  // message read twice off the screen must map to the same entry.
  it('gives one absorbed message the same id however often it is read', () => {
    const once = witnessesToRemember([witness({ id: 'absorbed-1', text: 'same words' })])
    const twice = witnessesToRemember([witness({ id: 'absorbed-2', text: 'same words' })])
    expect(once[0]?.id).toBe(twice[0]?.id)
  })

  it('keeps the ones worth writing and drops the rest, in order', () => {
    expect(
      witnessesToRemember([
        witness({ id: 'absorbed-1', text: 'first' }),
        witness({ id: 'absorbed-2', text: 'guess', provisional: true }),
        witness({ id: 'desk-n2', text: 'third' })
      ]).map((entry) => entry.text)
    ).toEqual(['first', 'third'])
  })
})
