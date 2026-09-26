import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  acceptOwnSendInPending,
  echoMemoryId,
  rememberEchoInPending,
  sweepWitnessedEchoes
} from './mobile-native-chat-remember-echo'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { SUBAGENT_HANDBACK_PROMPT, SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'

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

// 2026-09-26: the prompt hook's copy of a subagent's message (Claude Code
// 2.1.283's `<agent-message …>`) was drawn as a desktop prompt, the user's own
// bubble, and remembered with the phone's sends. The hook's copy is no longer
// a desktop prompt (desktop-prompt-merge.ts); one already on disk must not
// come back as the user's bubble on the next launch.
describe('a subagent message remembered as a desktop prompt before that was fixed', () => {
  it('is swept from what the phone restores, and a phone send is not', () => {
    const stored = [
      { id: 'desk-4101', text: SUBAGENT_REQUEST_PROMPT, expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true },
      { id: 'pending-1', text: 'a phone send', expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true },
      { id: 'desk-4102', text: 'typed at the desk', expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true }
    ]
    expect(sweepWitnessedEchoes(stored).map((i) => i.id)).toEqual(['pending-1', 'desk-4102'])
  })

  it('is swept when the hook cut it, with no closing tag, as the store kept it', () => {
    const stored = [{ id: 'desk-4103', text: SUBAGENT_HANDBACK_PROMPT, expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true }]
    expect(sweepWitnessedEchoes(stored)).toEqual([])
  })
})

// Review of 2026-09-26: the sweep used the shared harness classifier, which
// matches by a leading word or tag, so it deleted real messages the person
// typed from what the phone restores. Only the wrapper shape the old build
// stored is swept.
describe('a message the person typed, remembered as a witness, on the next launch', () => {
  const base = { expectedOccurrence: 1, baselineTailMessageId: 'a1', baselineResolved: true }

  it('is restored when it starts "A message arrived from"', () => {
    const stored = [{ id: 'desk-4101', text: 'A message arrived from the backend team: the deploy failed, check the logs', ...base }]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['desk-4101'])
  })

  it('is restored from the queue box when it starts "No response requested."', () => {
    const stored = [{ id: 'absorbed-abc', text: 'No response requested. Just note that the API moved to v3.', ...base }]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['absorbed-abc'])
  })

  it('is swept when it is another session\'s delivery the old build stored, and kept when it only quotes the opener', () => {
    const delivery = 'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/66525.sock" from-name="code-ui-6f">\n<agent-message from="a379d31745861b502">\nCapture probe\n</agent-message>\n</cross-session-message>'
    const stored = [
      { id: 'desk-4105', text: delivery, ...base },
      { id: 'desk-4106', text: 'Another Claude session sent a message: what does that mean?', ...base }
    ]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['desk-4106'])
  })

  // Review of 2026-09-27: it is drawn as the user's bubble live (no closing
  // tag, and the hook did not cut it), and the sweep took it as cut.
  it('is restored when it quotes the wrapper\'s whole first line and goes on in its own words', () => {
    const text = '<agent-message from="a7a46867b4f497c96">\nwhat is this line in my log?'
    const stored = [{ id: 'desk-4107', text, ...base }]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['desk-4107'])
  })

  it('is restored from the queue box when it only reads like a peer row, and the TUI\'s own row stored as one is swept', () => {
    const stored = [
      { id: 'absorbed-peer', text: 'Message from @a9d5c2f85e94ca47f (ctrl+o to expand)', ...base },
      { id: 'absorbed-typed', text: 'Message from me: please look at the queue', ...base }
    ]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['absorbed-typed'])
  })

  // Review of 9f9aa4a0..a6857609, item 4: a person's queued message that
  // opens "Message from @name:" was swept, and for a mid-turn send with no
  // desk copy that witness is the only record of it.
  it('is restored from the queue box when it opens "Message from @name:" in the person\'s own words', () => {
    const stored = [
      { id: 'absorbed-typed', text: 'Message from @sarah: the deploy failed, can you look?', ...base },
      { id: 'absorbed-peer', text: 'Message from @code-ui-6f: Capture probe from the Code UI session (ctrl+o to expand)', ...base }
    ]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['absorbed-typed'])
  })

  it('is restored when it opens by quoting an <agent-message> tag', () => {
    const stored = [{ id: 'desk-4104', text: '<agent-message from="a1b2c3"> keeps showing in my log, why?', ...base }]
    expect(sweepWitnessedEchoes(stored).map((item) => item.id)).toEqual(['desk-4104'])
  })
})
