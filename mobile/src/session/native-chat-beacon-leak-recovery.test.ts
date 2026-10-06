import { beforeEach, describe, expect, it } from 'vitest'
import { consumeAgentHudBeacons, getAgentHudBeacon, resetAgentHudBeacons } from './agent-hud-beacon'
import { encodeAgentHudChannelFrame } from './agent-hud-channel'
import { readNativeChatTabStatus } from './native-chat-kept-session'

// 2026-10-06: a test run leaked a beacon frame for a synthetic session into the
// user's real Orca tab. The phone read the tab as "Another agent started in this
// tab reported session 790eafa8. The chat stays on Claude's own session
// 00000000, which the desktop has no transcript for." These pin how it
// recovers, so the answer to "is the tab stuck for good" is a test, not a guess.
// The cause was the test's, not the phone's: nothing here changes a session rule.
const LEAKED = '00000000-0000-4000-8000-000000000000'
const REAL = '790eafa8-07b2-4380-abc2-90e22f965369'
const TRANSCRIPT = `/Users/x/.claude/projects/-p/${REAL}.jsonl`
const frame = (sid: string) => `CUIHUD1 agent=claude hk=1 hb=5 sid=${sid} model=claude-fable-5-1 name=Fable%205.1 effort=medium`
const read = (painting: string | null) =>
  readNativeChatTabStatus({
    agent: 'claude',
    providerSession: { id: REAL, transcriptPath: TRANSCRIPT },
    kept: null,
    keptTurn: null,
    painting
  })

describe('a beacon frame for a session that is not the tab’s', () => {
  beforeEach(() => resetAgentHudBeacons())

  it('holds the chat on that session only while its beacon is FRESH (the 30 s window the liveness rule keeps)', () => {
    expect(read(LEAKED)).toMatchObject({ kind: 'nested', nestedSessionId: REAL, read: { sessionId: LEAKED }, reason: { kind: 'painting' } })
  })

  it('lets go once the beacon is no longer fresh: the status’s own session is the chat again', () => {
    expect(read(null)).toMatchObject({ kind: 'own', sessionId: REAL, transcriptPath: TRANSCRIPT })
  })

  it('is replaced at once by the next frame of the real session on that terminal', () => {
    consumeAgentHudBeacons('t1', encodeAgentHudChannelFrame(frame(LEAKED)))
    expect(getAgentHudBeacon('t1')?.sessionId).toBe(LEAKED)
    consumeAgentHudBeacons('t1', encodeAgentHudChannelFrame(frame(REAL)))
    expect(getAgentHudBeacon('t1')?.sessionId).toBe(REAL)
    expect(read(getAgentHudBeacon('t1')?.sessionId ?? null)).toMatchObject({ kind: 'own', sessionId: REAL })
  })
})
