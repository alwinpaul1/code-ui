import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_PAUSE_THRESHOLD_MS,
  APP_PAUSE_TICK_MS,
  AppPauseDetector,
  appPauseLogEntry
} from './app-pause-detector'

// A real pause is time passing with no timer firing. Fake timers model that by
// moving the clock without running anything, then letting the late tick fire.
function pauseFor(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

function makeDetector(onPause = vi.fn()) {
  const detector = new AppPauseDetector({
    now: Date.now,
    setTimer: (handler, ms) => setTimeout(handler, ms),
    clearTimer: (handle) => clearTimeout(handle),
    onPause
  })
  return { detector, onPause }
}

describe('noticing that Android paused the app', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:19:14Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('reports the three hours no timer ran on 2026-09-23, from the last tick to the late one', () => {
    const { detector, onPause } = makeDetector()
    detector.start()
    const lastOnTime = Date.now()
    pauseFor(3 * 60 * 60_000)
    vi.advanceTimersByTime(APP_PAUSE_TICK_MS)

    expect(onPause).toHaveBeenCalledOnce()
    expect(onPause).toHaveBeenCalledWith({ from: lastOnTime, to: Date.now() })
    detector.stop()
  })

  it('stays quiet while the app runs, however long', () => {
    const { detector, onPause } = makeDetector()
    detector.start()
    vi.advanceTimersByTime(24 * 60 * 60_000)

    expect(onPause).not.toHaveBeenCalled()
    detector.stop()
  })

  it('treats a tick exactly at the threshold as jitter, and one past it as a pause', () => {
    const { detector, onPause } = makeDetector()
    detector.start()
    pauseFor(APP_PAUSE_THRESHOLD_MS)
    vi.advanceTimersByTime(APP_PAUSE_TICK_MS)

    expect(onPause).not.toHaveBeenCalled()
    pauseFor(APP_PAUSE_THRESHOLD_MS + 1)
    vi.advanceTimersByTime(APP_PAUSE_TICK_MS)
    expect(onPause).toHaveBeenCalledOnce()
    detector.stop()
  })

  it('keeps watching after a reporter that throws', () => {
    const onPause = vi.fn(() => {
      throw new Error('log store unavailable')
    })
    const { detector } = makeDetector(onPause)
    detector.start()
    pauseFor(60 * 60_000)
    expect(() => vi.advanceTimersByTime(APP_PAUSE_TICK_MS)).toThrow('log store unavailable')
    pauseFor(60 * 60_000)
    expect(() => vi.advanceTimersByTime(APP_PAUSE_TICK_MS)).toThrow('log store unavailable')

    expect(onPause).toHaveBeenCalledTimes(2)
    detector.stop()
  })

  it('reports nothing once stopped, and starts once however often it is started', () => {
    const { detector, onPause } = makeDetector()
    detector.start()
    detector.start()
    expect(vi.getTimerCount()).toBe(1)
    detector.stop()
    pauseFor(3 * 60 * 60_000)
    vi.advanceTimersByTime(APP_PAUSE_TICK_MS)

    expect(onPause).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the line a pause leaves in the connection log', () => {
  const from = Date.parse('2026-09-23T12:19:14Z')

  it('names how long nothing ran, since when, and what the app found on waking', () => {
    const entry = appPauseLogEntry(
      { from, to: from + 3 * 60 * 60_000 + 32_000 },
      { serviceRunning: true, unrestricted: false }
    )
    expect(entry).toMatchObject({ level: 'warn', code: 'app-paused', message: 'Android paused the app' })
    expect(entry.detail).toBe(
      'Nothing ran for 3h 0m (since 2026-09-23T12:19:14.000Z): no reconnects, no notifications. ' +
        'On waking: background service running, battery optimised'
    )
  })

  it('reads a pause under an hour in minutes, and a stopped service as not running', () => {
    const entry = appPauseLogEntry(
      { from, to: from + 12 * 60_000 },
      { serviceRunning: false, unrestricted: true }
    )
    expect(entry.detail).toContain('Nothing ran for 12m ')
    expect(entry.detail).toContain('background service not running, battery unrestricted')
  })
})
