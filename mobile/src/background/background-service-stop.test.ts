import { describe, expect, it } from 'vitest'
import { describeBackgroundServiceStop } from './background-service-stop'

// Local wall-clock times, so the fixtures read the way the log does.
const started = new Date(2026, 8, 27, 12, 40).getTime()
const stopped = new Date(2026, 8, 27, 12, 53).getTime()

describe('why the background service stopped, from what it left behind', () => {
  it('names the stop the service recorded after it last started', () => {
    expect(
      describeBackgroundServiceStop({ startedAt: started, stoppedAt: stopped, cause: 'task-ended' })
    ).toEqual({ at: stopped, cause: 'its task ended' })
  })

  it.each([
    ['js-stop', 'the app stopped it (background delivery or notifications are off)'],
    ['timeout', "Android's foreground-service time limit ran out"],
    ['task-removed', 'Android stopped it after the app was swiped from Recents'],
    ['external', 'Android stopped it']
  ])('names a %s stop in words', (cause, words) => {
    expect(describeBackgroundServiceStop({ startedAt: started, stoppedAt: stopped, cause })?.cause).toBe(words)
  })

  it('passes on a cause it has no words for rather than dropping it', () => {
    expect(describeBackgroundServiceStop({ startedAt: started, stoppedAt: stopped, cause: 'new-cause' })?.cause).toBe(
      'it stopped (new-cause)'
    )
  })

  // A killed process never reaches onDestroy, so the last recorded stop is
  // from an earlier run. ApplicationExitInfo is then the only witness.
  it('falls back to how the process ended when the run it belongs to recorded no stop', () => {
    const killed = new Date(2026, 8, 27, 13, 5).getTime()
    expect(
      describeBackgroundServiceStop({
        startedAt: started,
        stoppedAt: started - 60_000,
        cause: 'js-stop',
        exitAt: killed,
        exitReason: 3,
        exitDescription: null
      })
    ).toEqual({ at: killed, cause: "Android ended the app's process (low memory)" })
  })

  it("adds Android's own description of the exit, and a swipe that came first", () => {
    const killed = new Date(2026, 8, 27, 13, 5).getTime()
    expect(
      describeBackgroundServiceStop({
        startedAt: started,
        taskRemovedAt: killed - 1_000,
        exitAt: killed,
        exitReason: 13,
        exitDescription: 'remove task'
      })?.cause
    ).toBe("Android ended the app's process (killed by the system: remove task) after the app was swiped from Recents")
  })

  it('does not blame a process exit from before the run started', () => {
    expect(
      describeBackgroundServiceStop({ startedAt: started, stoppedAt: started - 1, exitAt: started - 1, exitReason: 3 })
    ).toBeNull()
  })

  it('knows nothing when nothing was recorded', () => {
    expect(describeBackgroundServiceStop(null)).toBeNull()
    expect(describeBackgroundServiceStop({})).toBeNull()
  })

  // Rule 7: whatever the native side hands back, this must not throw or invent a time.
  it('ignores a record whose fields are not times', () => {
    const malformed = { startedAt: 'yesterday', stoppedAt: Number.NaN, cause: 42 } as unknown as Parameters<
      typeof describeBackgroundServiceStop
    >[0]
    expect(describeBackgroundServiceStop(malformed)).toBeNull()
  })
})
