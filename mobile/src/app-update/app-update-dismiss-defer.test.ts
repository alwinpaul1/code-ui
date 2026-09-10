import { afterEach, describe, expect, it, vi } from 'vitest'
import { deferDialogDismiss } from './app-update-dismiss-defer'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('closing the update dialog with a normal press', () => {
  it('waits for the touch to finish before tearing the dialog down', () => {
    // Reproduced on a Galaxy S23 running 0.2.97 on 2026-09-10, and recorded.
    // An instant tap is fine; a press held for 400 ms is not. Dismissing inside
    // the press handler removes the dialog's own window while the system is
    // still delivering that gesture, so the release reaches the screen behind
    // and lights up whatever sits under the finger, which is the repository
    // row on the About screen.
    vi.useFakeTimers()
    const close = vi.fn()

    deferDialogDismiss(close)

    expect(close).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes on the next frame when the platform offers one', () => {
    const frames: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      frames.push(fn)
      return 1
    })
    const close = vi.fn()

    deferDialogDismiss(close)
    expect(close).not.toHaveBeenCalled()

    frames.forEach((frame) => frame())
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes exactly once, however the frame and the timer race', () => {
    vi.useFakeTimers()
    const frames: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      frames.push(fn)
      return 1
    })
    const close = vi.fn()

    deferDialogDismiss(close)
    frames.forEach((frame) => frame())
    vi.runAllTimers()

    expect(close).toHaveBeenCalledOnce()
  })
})
