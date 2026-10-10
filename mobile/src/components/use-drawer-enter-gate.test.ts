import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAWER_ENTER_FALLBACK_MS, useDrawerEnterGate } from './use-drawer-enter-gate'

// The + sheet "opens slowly or stutters and then opens" (2026-10-10): its open
// ran before its window was up and before it knew its height. The gate holds the
// open for both. These pin what the gate must never do while holding it: leave a
// sheet invisible for good, or play an open nobody wants any more.

type Gate = ReturnType<typeof useDrawerEnterGate>

let renderer: ReactTestRenderer | null = null

function mountGate(windowAlreadyShown: boolean, enter: () => void): Gate {
  const holder: { gate: Gate | null } = { gate: null }
  function Probe(): null {
    holder.gate = useDrawerEnterGate({ windowAlreadyShown, enter })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return holder.gate!
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('a sheet waiting for its window and its height before it opens', () => {
  it('opens once both have arrived, in either order, and only once', () => {
    const enter = vi.fn()
    const gate = mountGate(false, enter)
    gate.request()
    gate.layoutMeasured()
    expect(enter, 'opened with no window to draw in').not.toHaveBeenCalled()
    gate.windowShown()
    expect(enter).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(DRAWER_ENTER_FALLBACK_MS * 2)
    expect(enter, 'the fallback played a second open').toHaveBeenCalledTimes(1)
  })

  it('opens at once inside a modal host, as soon as it has laid out', () => {
    const enter = vi.fn()
    const gate = mountGate(true, enter)
    gate.request()
    expect(enter).not.toHaveBeenCalled()
    gate.layoutMeasured()
    expect(enter).toHaveBeenCalledTimes(1)
  })

  it('opens anyway when the platform never reports its window or its layout', () => {
    const enter = vi.fn()
    const gate = mountGate(false, enter)
    gate.request()
    vi.advanceTimersByTime(DRAWER_ENTER_FALLBACK_MS - 1)
    expect(enter).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(enter, 'a sheet left mounted and invisible over the app').toHaveBeenCalledTimes(1)
  })

  it('does not play in after it was closed before its open could start', () => {
    const enter = vi.fn()
    const gate = mountGate(false, enter)
    gate.request()
    gate.cancel()
    gate.windowShown()
    gate.layoutMeasured()
    vi.advanceTimersByTime(DRAWER_ENTER_FALLBACK_MS * 2)
    expect(enter).not.toHaveBeenCalled()
  })

  it('plays at once when asked again with its window and height already known (a refused close, a reopen)', () => {
    const enter = vi.fn()
    const gate = mountGate(false, enter)
    gate.windowShown()
    gate.layoutMeasured()
    expect(enter, 'nothing asked for an open yet').not.toHaveBeenCalled()
    gate.request()
    expect(enter).toHaveBeenCalledTimes(1)
    gate.request()
    expect(enter).toHaveBeenCalledTimes(2)
  })

  it('leaves no fallback behind once unmounted', () => {
    const enter = vi.fn()
    const gate = mountGate(false, enter)
    gate.request()
    act(() => renderer!.unmount())
    renderer = null
    vi.advanceTimersByTime(DRAWER_ENTER_FALLBACK_MS * 2)
    expect(enter).not.toHaveBeenCalled()
  })
})
