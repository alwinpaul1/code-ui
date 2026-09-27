import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configurePickerGateStaleEscape,
  PickerGateAbandonedError,
  resetPickerGateForTests,
  withPickerGate
} from './mobile-picker-gate'

/** A picker call that stays open until `close()`, like Android's create-document picker while the
 *  user is still choosing a folder. */
function pendingOpen<T>(value: T) {
  let close!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    close = resolve
  })
  return { open: vi.fn(() => promise), close: () => close(value) }
}

/** A picker call whose result never comes back at all -- the shape of the real, if rare,
 *  Android fault the stale escape exists for (`OnActivityResult` never delivered). */
function lostPicker<T = string>() {
  return vi.fn(() => new Promise<T>(() => {}))
}

beforeEach(() => {
  resetPickerGateForTests()
})

describe('the shared picker gate', () => {
  it('holds a second request until the first picker closes', async () => {
    const first = pendingOpen('uri-1')
    const second = pendingOpen('uri-2')

    const a = withPickerGate(first.open)
    const b = withPickerGate(second.open)

    await Promise.resolve()
    await Promise.resolve()
    expect(second.open).not.toHaveBeenCalled()

    first.close()
    expect(await a).toBe('uri-1')
    await vi.waitFor(() => expect(second.open).toHaveBeenCalledTimes(1))

    second.close()
    expect(await b).toBe('uri-2')
  })

  it('opens the next request even when the picker ahead of it rejects', async () => {
    const first = vi.fn(() => Promise.reject(new Error('IntentLauncher activity is already started')))
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(first)
    const b = withPickerGate(second)

    await expect(a).rejects.toThrow('IntentLauncher activity is already started')
    expect(await b).toBe('uri-2')
  })

  it('never opens a picker for a waiter whose signal aborted before its turn came', async () => {
    const held = pendingOpen('uri-1')
    const controller = new AbortController()
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(held.open)
    const b = withPickerGate(second, { signal: controller.signal })
    controller.abort()

    held.close()
    expect(await a).toBe('uri-1')
    await expect(b).rejects.toBeInstanceOf(PickerGateAbandonedError)
    expect(second).not.toHaveBeenCalled()
  })

  it('never opens a picker for a waiter whose screen went away before its turn came', async () => {
    const held = pendingOpen('uri-1')
    let onScreen = true
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(held.open)
    const b = withPickerGate(second, { isStillWanted: () => onScreen })
    onScreen = false

    held.close()
    expect(await a).toBe('uri-1')
    await expect(b).rejects.toBeInstanceOf(PickerGateAbandonedError)
    expect(second).not.toHaveBeenCalled()
  })

  it('settles at once when its signal aborts, even though the picker ahead of it never returns', async () => {
    const stuck = lostPicker()
    const controller = new AbortController()
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(stuck)
    const b = withPickerGate(second, { signal: controller.signal })
    controller.abort()

    // `a`'s own picker never comes back; `b` must not wait on it to learn it dropped out.
    await expect(b).rejects.toBeInstanceOf(PickerGateAbandonedError)
    expect(second).not.toHaveBeenCalled()
    void a // deliberately never settles
  })

  it('does not hold up a third request just because the second one dropped out', async () => {
    const held = pendingOpen('uri-1')
    const controller = new AbortController()
    const third = vi.fn(() => Promise.resolve('uri-3'))

    const a = withPickerGate(held.open)
    const b = withPickerGate(
      () => Promise.resolve('uri-2'),
      { signal: controller.signal }
    )
    controller.abort()
    const c = withPickerGate(third)

    held.close()
    expect(await a).toBe('uri-1')
    await expect(b).rejects.toBeInstanceOf(PickerGateAbandonedError)
    expect(await c).toBe('uri-3')
  })

  it('opens three requests made back to back one at a time, in the order they were made', async () => {
    const opened: string[] = []
    const first = pendingOpen('uri-1')
    const second = pendingOpen('uri-2')
    const third = pendingOpen('uri-3')
    const track =
      (name: string, gate: ReturnType<typeof pendingOpen<string>>) =>
      () => {
        opened.push(name)
        return gate.open()
      }

    const a = withPickerGate(track('first', first))
    const b = withPickerGate(track('second', second))
    const c = withPickerGate(track('third', third))

    await vi.waitFor(() => expect(opened).toEqual(['first']))
    first.close()
    await expect(a).resolves.toBe('uri-1')
    await vi.waitFor(() => expect(opened).toEqual(['first', 'second']))

    second.close()
    await expect(b).resolves.toBe('uri-2')
    await vi.waitFor(() => expect(opened).toEqual(['first', 'second', 'third']))

    third.close()
    await expect(c).resolves.toBe('uri-3')
  })
})

describe('the stale-picker escape', () => {
  afterEach(() => {
    vi.useRealTimers()
    configurePickerGateStaleEscape(null)
  })

  it('lets the next request through once the app has been active for the threshold, without touching the stuck one', async () => {
    vi.useFakeTimers()
    configurePickerGateStaleEscape({ isActive: () => true, activeMs: 4000, pollMs: 500 })
    const stuck = lostPicker()
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(stuck)
    const b = withPickerGate(second)
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(3500)
    expect(second).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(second).toHaveBeenCalledTimes(1)
    expect(await b).toBe('uri-2')

    // `a`'s own picker is still exactly as unsettled as it was -- the escape only frees the queue
    // behind it, matching main, where the FIRST (lost) save also never resolved on its own.
    void a
  })

  it('does not let the next request through while the app has not come back to the foreground', async () => {
    vi.useFakeTimers()
    configurePickerGateStaleEscape({ isActive: () => false, activeMs: 4000, pollMs: 500 })
    const stuck = lostPicker()
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(stuck)
    const b = withPickerGate(second)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(20_000)

    expect(second).not.toHaveBeenCalled()
    void a
    void b
  })

  it('restarts the active timer if the app leaves the foreground before the threshold', async () => {
    vi.useFakeTimers()
    let active = true
    configurePickerGateStaleEscape({ isActive: () => active, activeMs: 4000, pollMs: 500 })
    const stuck = lostPicker()
    const second = vi.fn(() => Promise.resolve('uri-2'))

    const a = withPickerGate(stuck)
    const b = withPickerGate(second)
    await vi.advanceTimersByTimeAsync(0)

    // Within the first active streak, short of the threshold.
    await vi.advanceTimersByTimeAsync(3500)
    // A real picker opens over the app again before the threshold; the old streak's remaining
    // 500ms would otherwise have crossed it here.
    active = false
    await vi.advanceTimersByTimeAsync(3500)
    expect(second).not.toHaveBeenCalled()

    // Back to the foreground: a full fresh streak, plus a poll's worth of margin either side.
    active = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(second).toHaveBeenCalledTimes(1)
    expect(await b).toBe('uri-2')
    void a
  })
})
