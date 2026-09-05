import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTerminalAccessoryRepeatController,
  TERMINAL_ACCESSORY_REPEAT_DELAY_MS,
  TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS
} from './terminal-accessory-repeat'

describe('terminal accessory held repeat (#12251)', () => {
  afterEach(() => vi.useRealTimers())

  it('emits nothing when the press is released before the hold delay', async () => {
    vi.useFakeTimers()
    const send = vi.fn(async () => true)
    const repeat = createTerminalAccessoryRepeatController<string>()

    repeat.startHeld('down', send)
    await vi.advanceTimersByTimeAsync(TERMINAL_ACCESSORY_REPEAT_DELAY_MS - 50)
    expect(repeat.hasFired()).toBe(false)
    repeat.stop()
    await vi.runAllTimersAsync()

    expect(send).not.toHaveBeenCalled()
  })

  it('starts repeating once the key has been held past the delay', async () => {
    vi.useFakeTimers()
    const send = vi.fn(async () => true)
    const repeat = createTerminalAccessoryRepeatController<string>()

    repeat.startHeld('down', send)
    await vi.advanceTimersByTimeAsync(TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(repeat.hasFired()).toBe(true)

    await vi.advanceTimersByTimeAsync(TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS * 3 + 5)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3)

    repeat.stop()
    const afterStop = send.mock.calls.length
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenCalledTimes(afterStop)
  })

  it('a swipe that steals the touch never reaches the terminal', async () => {
    vi.useFakeTimers()
    const send = vi.fn(async () => true)
    const repeat = createTerminalAccessoryRepeatController<string>()

    // press-in → ScrollView takes over → press-out (no press event follows)
    repeat.startHeld('left', send)
    await vi.advanceTimersByTimeAsync(80)
    const firedBeforeRelease = repeat.hasFired()
    repeat.stop()
    await vi.runAllTimersAsync()

    expect(firedBeforeRelease).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('immediate start still reports fired for legacy callers', () => {
    const send = vi.fn(async () => true)
    const repeat = createTerminalAccessoryRepeatController<string>()
    repeat.start('down', send)
    expect(repeat.hasFired()).toBe(true)
    repeat.stop()
  })
})
