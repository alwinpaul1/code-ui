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
    ).toEqual({ kind: 'background', count: null })
  })

  it('never uses an inactive tab’s stale beacon for a count', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2']),
        false
      )
    ).toEqual({ kind: 'background', count: null })
  })

  it('counts the active tab’s shells the agent still lists, minus those it wrote as done', () => {
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1', 't2'], ['t1']),
        true
      )
    ).toEqual({ kind: 'background', count: 1 })
  })

  it('counts shells the transcript tail shows launched even before the Stop hook lists them', () => {
    // Why: desk "3 shells", phone "1" (2026-09-11) — two launches were newer
    // than the last Stop hook and older than the loaded window.
    expect(
      sessionTabActivity(
        { state: 'working', workingMode: 'monitoring' },
        beacon(['t1'], [], ['t1', 't2', 't3']),
        true
      )
    ).toEqual({ kind: 'background', count: 3 })
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
    expect(sessionTabActivity({ state: 'working' }, null, false)).toEqual({ kind: 'working' })
  })
})
