import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appAwayMsSince,
  appForegroundSince,
  appWasAwaySince,
  noteAppForeground,
  resetAppForegroundClockForTests,
  subscribeAppForegroundClock,
  type AppStateSource
} from './app-foreground-clock'

afterEach(() => resetAppForegroundClockForTests())

describe('the app foreground clock', () => {
  it('reports a never-fed clock as never away, which is how every send clock behaved before it', () => {
    expect(appWasAwaySince(0)).toBe(false)
    expect(appForegroundSince()).toBe(Number.NEGATIVE_INFINITY)
  })

  it('reports the app as away while it is, and from when it came back once it has', () => {
    noteAppForeground(false, 1_000)
    expect(appWasAwaySince(5_000)).toBe(true)
    expect(appForegroundSince()).toBeNull()
    noteAppForeground(true, 9_000)
    expect(appForegroundSince()).toBe(9_000)
    // A window that began before the return was away for part of it; one after was not.
    expect(appWasAwaySince(500)).toBe(true)
    expect(appWasAwaySince(8_999)).toBe(true)
    expect(appWasAwaySince(9_000)).toBe(false)
    expect(appWasAwaySince(12_000)).toBe(false)
  })

  it('measures only the part of the latest time away inside the stretch asked about', () => {
    expect(appAwayMsSince(0, 50_000)).toBe(0)
    noteAppForeground(false, 10_000)
    expect(appAwayMsSince(0, 12_000)).toBe(2_000)
    expect(appAwayMsSince(11_000, 12_000)).toBe(1_000)
    noteAppForeground(true, 15_000)
    expect(appAwayMsSince(0, 60_000)).toBe(5_000)
    expect(appAwayMsSince(14_000, 60_000)).toBe(1_000)
    expect(appAwayMsSince(15_000, 60_000)).toBe(0)
    expect(appAwayMsSince(20_000, 60_000)).toBe(0)
  })

  it('ignores a repeated state, so a second `active` does not move the return', () => {
    noteAppForeground(false, 1_000)
    noteAppForeground(true, 2_000)
    noteAppForeground(true, 7_000)
    expect(appForegroundSince()).toBe(2_000)
  })

  it('is fed by AppState changes, `active` as the foreground and anything else as away, until unsubscribed', () => {
    let listener: ((state: string) => void) | null = null
    const remove = vi.fn(() => {
      listener = null
    })
    const appState: AppStateSource = {
      addEventListener: (_type, next) => {
        listener = next
        return { remove }
      }
    }
    const unsubscribe = subscribeAppForegroundClock(appState)
    listener!('background')
    expect(appForegroundSince()).toBeNull()
    listener!('active')
    expect(appForegroundSince()).not.toBeNull()
    unsubscribe()
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('the app root', () => {
  // A structural defect has no behaviour to drive: if nothing feeds the clock, every send
  // clock silently reads the app as never away and the 2026-10-09 report comes back. The
  // root's own comments name the call too, so only code lines count.
  it('feeds the foreground clock from AppState on mount', () => {
    const code = readFileSync(join(import.meta.dirname, '..', '..', 'app', '_layout.tsx'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).toMatch(/import \{ subscribeAppForegroundClock \} from '\.\.\/src\/session\/app-foreground-clock'/)
    expect(code).toMatch(/useEffect\(\(\) => subscribeAppForegroundClock\(AppState\), \[\]\)/)
  })
})
