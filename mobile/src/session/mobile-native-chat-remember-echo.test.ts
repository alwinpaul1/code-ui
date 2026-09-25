import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  acceptOwnSendInPending,
  echoMemoryId,
  promptTakenSince,
  rememberEchoInPending,
  sweepWitnessedEchoes
} from './mobile-native-chat-remember-echo'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

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

// 2026-09-25 (Claude Code 2.1.281): the hook's copy of a phone send reached the
// phone before the send's own ack, was remembered as `desk-…`, and drew beside
// the send once Claude took it. The send is accepted over its own witness.
describe('a phone send acknowledged after a witness of it was stored', () => {
  const tapAt = Date.parse('2026-09-25T08:24:19.000Z')
  const origin = {
    draftKey: 'd',
    draftEditGeneration: 0,
    pendingKey: 'k',
    normalizedText: 'working w capital',
    baselineOccurrences: 0,
    baselineTailMessageId: 'a1',
    baselineResolved: true,
    sentAt: tapAt
  }
  const witness = (id: string, text: string, storedAt?: number) =>
    rememberEchoInPending({}, 'k', id, text, 'a1', [], 'd', storedAt).k![0]!
  const accept = (
    stored: ReturnType<typeof witness>[],
    send: MobileNativeChatSendOrigin = origin,
    text = 'Working W capital'
  ) =>
    acceptOwnSendInPending({ k: stored }, 'k', 'pending-1', send, text).k!

  it('stamps when each witness was stored', () => {
    expect(witness('desk-status:x:1', 'Working W capital', tapAt + 320).witnessedAt).toBe(tapAt + 320)
  })

  it('drops the hook copy and the queue-box stub stored in the gap, and counts neither as an earlier landing', () => {
    const accepted = accept([
      witness('desk-status:x:1', 'Working W capital', tapAt + 320),
      witness(echoMemoryId('Working W…'), 'Working W…', tapAt + 900)
    ])
    expect(accepted.map((item) => item.id)).toEqual(['pending-1'])
    expect(accepted[0]!.expectedOccurrence).toBe(1)
  })

  it('keeps a message typed at the desk before the tap, and one stored by a build that kept no time', () => {
    const earlier = witness('desk-status:x:0', 'Working W capital', tapAt - 1)
    const unstamped = { ...witness(echoMemoryId('Working W capital'), 'Working W capital', tapAt + 5), witnessedAt: undefined }
    expect(accept([earlier]).map((item) => item.id)).toEqual(['desk-status:x:0', 'pending-1'])
    expect(accept([unstamped]).map((item) => item.id)).toEqual([unstamped.id, 'pending-1'])
  })

  it('keeps a different message stored in the gap, and drops nothing for a send with no time', () => {
    const other = witness('desk-status:x:1', 'look at the logs', tapAt + 320)
    expect(accept([other]).map((item) => item.id)).toEqual(['desk-status:x:1', 'pending-1'])
    const same = witness('desk-status:x:2', 'Working W capital', tapAt + 320)
    expect(accept([same], { ...origin, sentAt: undefined }).map((item) => item.id)).toEqual(['desk-status:x:2', 'pending-1'])
  })

  it('accepts into an empty store, and never drops a phone send of the same text', () => {
    expect(accept([]).map((item) => item.id)).toEqual(['pending-1'])
    const earlierSend = { id: 'pending-0', text: 'Working W capital', expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true, sentAt: tapAt + 1 }
    expect(accept([earlierSend]).map((item) => item.id)).toEqual(['pending-0', 'pending-1'])
  })
})

// Review, 2026-09-25: reading a tab's echoes back dropped a hook copy with the
// text of a stored phone send even when the session had taken a newer prompt,
// so a message typed at the desk in a later turn was never drawn.
describe('promptTakenSince', () => {
  const sentAt = Date.parse('2026-09-25T17:04:15.000Z')
  const stamped = (id: string, text: string, at: number | null): NativeChatMessage => ({
    ...user(id, text),
    timestamp: at
  })

  it('says so for a user row stamped after the send', () => {
    expect(promptTakenSince([stamped('u1', 'now run the tests', sentAt + 400_000)], { sentAt }, 1000)).toBe(true)
  })

  it('says no for rows before the send or within the clock margin, and for an empty window', () => {
    expect(promptTakenSince([stamped('u1', 'earlier', sentAt - 60_000)], { sentAt }, 1000)).toBe(false)
    expect(promptTakenSince([stamped('u1', 'close', sentAt + 900)], { sentAt }, 1000)).toBe(false)
    expect(promptTakenSince([stamped('u1', 'untimed', null)], { sentAt }, 1000)).toBe(false)
    expect(promptTakenSince([], { sentAt }, 1000)).toBe(false)
  })

  it('says no for a row the harness injected, which leaves the tab status on the old prompt', () => {
    const notice = stamped('u1', '<task-notification><task-id>t1</task-id></task-notification>', sentAt + 400_000)
    expect(promptTakenSince([notice], { sentAt }, 1000)).toBe(false)
  })

  it('says no for a send with no time, since nothing can be ordered against it', () => {
    expect(promptTakenSince([stamped('u1', 'later', sentAt + 400_000)], {}, 1000)).toBe(false)
    expect(promptTakenSince([stamped('u1', 'later', sentAt + 400_000)], { sentAt: Number.NaN }, 1000)).toBe(false)
  })
})
