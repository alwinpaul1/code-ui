import { describe, expect, it } from 'vitest'
import { sessionTabActivity } from './session-tab-activity'

const S1 = '77954fea-1013-4225-b187-a8b3162a04ce'
const S2 = '8b19cb22-996c-40e5-a887-a5323a9845e1'

const beacon = (
  runningTaskIds: string[] | null,
  doneTaskIds: string[] = [],
  launchedTaskIds: string[] = [],
  sessionId: string | null = S1
) => ({
  sessionId,
  runningTaskIds,
  doneTaskIds,
  launchedTaskIds
})

// 2026-09-18: the beacon is keyed by terminal handle and a handle outlives
// the process that emitted into it. The last beacon of a phone-launched
// agent, saying every shell it knew of had finished, could retire the dot of
// the hand-started session that took over its terminal while the host still
// listed that session's shells as running.
describe('a dead process cannot retire the dot of the session that replaced it', () => {
  const monitoring = { state: 'working', workingMode: 'monitoring' } as const

  it('ignores a beacon from another session on the same handle', () => {
    expect(
      sessionTabActivity(monitoring, beacon(['t1', 't2'], ['t1', 't2'], [], S2), true, S1)
    ).toBe('background')
  })

  it('ignores a beacon that names no session while the tab knows its own', () => {
    expect(
      sessionTabActivity(monitoring, beacon(['t1'], ['t1'], [], null), true, S1)
    ).toBe('background')
  })

  it('ignores every beacon while the tab does not yet know its session', () => {
    expect(sessionTabActivity(monitoring, beacon(['t1'], ['t1']), true, null)).toBe('background')
  })

  it('still lets the tab\'s own session retire the dot', () => {
    expect(sessionTabActivity(monitoring, beacon(['t1'], ['t1']), true, S1)).toBeNull()
  })
})

describe('what a tab pill shows about background shells', () => {
  // Why: the user's desk on 2026-09-11 had a Claude tab reading "done 11:35 AM ·
  // 2 shells still running" while the phone's pill for it showed nothing, and
  // kept showing nothing after the shells finished.
  it('shows an inactive tab as running background work from the host status alone', () => {
    expect(
      sessionTabActivity({ state: 'working', workingMode: 'monitoring' }, null, false, S1)
    ).toBe('background')
  })

  it('never consults an inactive tab’s stale beacon', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1', 't2']),
        false,
        S1
      )
    ).toBe('background')
  })

  it('keeps showing background work while the active tab’s agent still lists a live shell', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1']),
        true,
        S1
      )
    ).toBe('background')
  })

  it('stays up while a shell the transcript tail shows launched is still unfinished', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon([], ['t1'], ['t1', 't2']),
        true,
        S1
      )
    ).toBe('background')
  })

  it('shows nothing, not a zero, once the agent has written every listed shell as done', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1', 't2']),
        true,
        S1
      )
    ).toBeNull()
  })

  it('clears when the host says the pane is done', () => {
    expect(sessionTabActivity({ state: 'done' }, beacon(['t1']), true, S1)).toBeNull()
    expect(sessionTabActivity(null, beacon(['t1']), true, S1)).toBeNull()
  })

  it('shows plain working while the turn itself is still running', () => {
    expect(sessionTabActivity({ state: 'working' }, null, false, S1)).toBe('working')
  })
})
