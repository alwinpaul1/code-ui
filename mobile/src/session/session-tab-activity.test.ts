import { describe, expect, it } from 'vitest'
import { sessionTabActivity } from './session-tab-activity'

const beacon = (
  runningTaskIds: string[] | null,
  doneTaskIds: string[] = [],
  launchedTaskIds: string[] = []
) => ({
  runningTaskIds,
  doneTaskIds,
  launchedTaskIds
})

describe('what a tab pill shows about background shells', () => {
  // Why: the user's desk on 2026-09-11 had a Claude tab reading "done 11:35 AM ·
  // 2 shells still running" while the phone's pill for it showed nothing, and
  // kept showing nothing after the shells finished.
  it('shows an inactive tab as running background work from the host status alone', () => {
    expect(
      sessionTabActivity({ state: 'working', workingMode: 'monitoring' }, null, false)
    ).toBe('background')
  })

  it('never consults an inactive tab’s stale beacon', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1', 't2']),
        false
      )
    ).toBe('background')
  })

  it('keeps showing background work while the active tab’s agent still lists a live shell', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1']),
        true
      )
    ).toBe('background')
  })

  it('stays up while a shell the transcript tail shows launched is still unfinished', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon([], ['t1'], ['t1', 't2']),
        true
      )
    ).toBe('background')
  })

  it('shows nothing, not a zero, once the agent has written every listed shell as done', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1', 't2']),
        true
      )
    ).toBeNull()
  })

  it('clears when the host says the pane is done', () => {
    expect(sessionTabActivity({ state: 'done' }, beacon(['t1']), true)).toBeNull()
    expect(sessionTabActivity(null, beacon(['t1']), true)).toBeNull()
  })

  it('shows plain working while the turn itself is still running', () => {
    expect(sessionTabActivity({ state: 'working' }, null, false)).toBe('working')
  })
})
