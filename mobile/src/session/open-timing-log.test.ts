import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatOpenTiming, openTimingClock } from './open-timing-log'
import { logSnapshot } from './mobile-native-chat-subscribe-identity'

// A slow open on 2026-10-17 left nothing in the log between the bundle's start and the chat's
// first snapshot. These pin the lines that now name the gap, so a grep for them keeps working.
describe('open timing names where a slow session open spent its time', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says how long after the bundle started, and after the app came back, a mark happened', () => {
    const start = Date.now()
    const clock = openTimingClock(start + 4500, start + 300)
    expect(clock).toMatch(/^\+\d+ ms since JS start, \+4200 ms since back in front$/)
  })

  it('leaves out the foreground part before the app has ever been away', () => {
    expect(openTimingClock(Date.now(), Number.NEGATIVE_INFINITY)).toMatch(/^\+\d+ ms since JS start$/)
  })

  it('says so when a mark lands while the app is in the background', () => {
    expect(openTimingClock(Date.now(), null)).toMatch(/ms since JS start, app in background$/)
  })

  it('writes one greppable line with its detail', () => {
    expect(formatOpenTiming('session screen opened', 'cached tabs=2', '+10 ms since JS start')).toBe(
      '[open-timing] session screen opened (cached tabs=2) at +10 ms since JS start'
    )
    expect(formatOpenTiming('session connected', undefined, '+10 ms since JS start')).toBe(
      '[open-timing] session connected at +10 ms since JS start'
    )
  })

  it('puts how long the chat read took on the snapshot line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = { type: 'snapshot', messages: [{}, {}], hasMore: true }
    expect(logSnapshot('[native-chat] subscribe session=7243984f', raw, { at: 1000, clock: '+900 ms since JS start' }, 1812)).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      '[native-chat] subscribe session=7243984f snapshot rows=2 hasMore=true in 812 ms, sent at +900 ms since JS start'
    )
  })

  it('keeps the snapshot line as it was when no send time is known', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSnapshot('[native-chat] subscribe session=x', { type: 'snapshot', messages: [], hasMore: false })
    expect(warn).toHaveBeenCalledWith('[native-chat] subscribe session=x snapshot rows=0 hasMore=false')
  })
})
