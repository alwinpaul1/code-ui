import { beforeEach, describe, expect, it } from 'vitest'
import { backgroundPowerPausedPrompt, promptAfterPause, resetPromptAfterPauseForTests } from './background-power-after-pause'

// 2026-09-23/24, from the phone: the relay showed "Reconnecting" after long
// spells in the background, and notifications stopped once the app left
// Recents. The connection log showed hours with no timer running at all:
// Android had paused the app, which only the Unrestricted battery setting
// prevents. The app now says so the moment it notices a pause, instead of
// leaving the reader to find the setting.
describe('asking for unrestricted battery once Android has paused the app', () => {
  beforeEach(() => resetPromptAfterPauseForTests())

  it('asks after a pause while the battery is optimised, naming how long nothing ran', () => {
    expect(promptAfterPause({ pausedMs: 3 * 60 * 60_000, unrestricted: false })).toBe(true)
    const copy = backgroundPowerPausedPrompt(3 * 60 * 60_000 + 32_000)
    expect(copy.title).toBe('Android paused Code UI')
    expect(copy.body).toContain('for 3 h 0 min')
    expect(copy.body).toContain('Unrestricted')
    expect(copy.confirm).toBe('Allow')
  })

  it('does not ask when the battery is already unrestricted', () => {
    expect(promptAfterPause({ pausedMs: 3 * 60 * 60_000, unrestricted: true })).toBe(false)
  })

  it('asks at most once while the app keeps running, so a second pause does not nag', () => {
    expect(promptAfterPause({ pausedMs: 20 * 60_000, unrestricted: false })).toBe(true)
    expect(promptAfterPause({ pausedMs: 60 * 60_000, unrestricted: false })).toBe(false)
  })

  it('reads a pause under an hour in minutes', () => {
    expect(backgroundPowerPausedPrompt(12 * 60_000).body).toContain('for 12 min')
  })
})
