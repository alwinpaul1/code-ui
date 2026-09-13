import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { echoMemoryId, rememberEchoInPending, sweepWitnessedEchoes } from './mobile-native-chat-remember-echo'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

// 2026-09-13: a message sent from the Claude app mid-turn showed on the phone
// right after an install and was gone an hour later, because it lived only in
// a witness hook's memory. Remembered with the phone's own sends it survives.
describe('rememberEchoInPending', () => {
  it('stores a witnessed message once, anchored, expecting one more landing than the transcript has', () => {
    const id = echoMemoryId('see these messages')
    const once = rememberEchoInPending({}, 'k', id, 'see these messages', 'a5', [user('u1', 'see these messages')], 'd')
    expect(once.k).toMatchObject([
      { id, text: 'see these messages', baselineTailMessageId: 'a5', expectedOccurrence: 2, baselineResolved: true }
    ])
    // Found again on the next reading, or after a relaunch: not stored twice.
    expect(rememberEchoInPending(once, 'k', id, 'see these messages', 'a5', [], 'd')).toBe(once)
  })

  it('gives the same text the same id however it was wrapped or marked', () => {
    expect(echoMemoryId('[Image #1] see  these\nmessages')).toBe(echoMemoryId('see these messages'))
    expect(echoMemoryId('see these messages')).not.toBe(echoMemoryId('see those messages'))
  })
})

// 2026-09-13: three readings of one message were stored, each under its own id.
describe('remembered readings of one message', () => {
  const clean = 'see these messages what happening dude'
  const glued = 'see these messages what happening dude Running 1 shell command…'
  it('refuses a reading that only glues rows onto a stored one, and replaces a glued one with the clean one', () => {
    const withClean = rememberEchoInPending({}, 'k', echoMemoryId(clean), clean, 'a1', [], 'd')
    expect(rememberEchoInPending(withClean, 'k', echoMemoryId(glued), glued, 'a1', [], 'd')).toBe(withClean)
    const withGlued = rememberEchoInPending({}, 'k', echoMemoryId(glued), glued, 'a1', [], 'd')
    const fixed = rememberEchoInPending(withGlued, 'k', echoMemoryId(clean), clean, 'a1', [], 'd')
    expect(fixed.k!.map((i) => i.text)).toEqual([clean])
  })
  it('refuses a witnessed reading that glues rows onto a phone send, and sweeps one already on disk', () => {
    const send = { id: 'pending-1', text: clean, expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true }
    expect(rememberEchoInPending({ k: [send] }, 'k', echoMemoryId(glued), glued, 'a1', [], 'd')).toEqual({ k: [send] })
    const onDisk = [{ ...send, id: echoMemoryId(glued), text: glued }, send]
    expect(sweepWitnessedEchoes(onDisk).map((i) => i.id)).toEqual(['pending-1'])
  })

  it('sweeps glued variants already on disk down to the clean reading', () => {
    const stored = [
      { id: echoMemoryId(glued), text: glued, expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true },
      { id: 'pending-1', text: 'a phone send', expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true },
      { id: echoMemoryId(clean), text: clean, expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true }
    ]
    expect(sweepWitnessedEchoes(stored).map((i) => i.text)).toEqual(['a phone send', clean])
  })
})
