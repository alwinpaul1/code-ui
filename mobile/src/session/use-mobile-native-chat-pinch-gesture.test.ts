import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FONT_SCALE_STEP, quantizeFontScale } from './mobile-native-chat-message-text'
import {
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from '../settings/chat-reading-settings'

const handlers: {
  start?: () => void
  update?: (e: { scale: number }) => void
  finalize?: (event: unknown, success: boolean) => void
} = {}
// The list's own scroll gesture, as the chat builds it.
const native: { cancelsOutside?: boolean; runOnJS?: boolean } = {}

vi.mock('react-native-gesture-handler', () => {
  const pinch = {
    runOnJS: () => pinch,
    onStart: (cb: () => void) => {
      handlers.start = cb
      return pinch
    },
    onUpdate: (cb: (e: { scale: number }) => void) => {
      handlers.update = cb
      return pinch
    }
  }
  const scroll = {
    shouldCancelWhenOutside: (value: boolean) => {
      native.cancelsOutside = value
      return scroll
    },
    runOnJS: (value: boolean) => {
      native.runOnJS = value
      return scroll
    },
    onFinalize: (cb: (event: unknown, success: boolean) => void) => {
      handlers.finalize = cb
      return scroll
    }
  }
  return {
    Gesture: { Simultaneous: (...g: unknown[]) => g, Native: () => scroll, Pinch: () => pinch }
  }
})

import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'

describe('quantizeFontScale', () => {
  it('snaps to the commit step and stays inside the supported range', () => {
    expect(quantizeFontScale(1)).toBe(1)
    expect(quantizeFontScale(1.01)).toBe(1)
    expect(quantizeFontScale(1.024)).toBe(1)
    expect(quantizeFontScale(1.03)).toBe(1.05)
    expect(quantizeFontScale(5)).toBe(1.8)
    expect(quantizeFontScale(0.1)).toBe(0.8)
    expect(quantizeFontScale(Number.NaN)).toBe(1)
  })

  it('collapses a full-range pinch to at most one commit per step', () => {
    const committed = new Set<number>()
    for (let i = 0; i <= 600; i++) {
      committed.add(quantizeFontScale(0.7 + i * 0.002))
    }
    expect(committed.size).toBeLessThanOrEqual(Math.round(1 / FONT_SCALE_STEP) + 1)
  })
})

describe('useMobileNativeChatPinchGesture', () => {
  let renderer: { unmount: () => void } | null = null
  let latest = 1

  const scrollGestureEnded = vi.fn()

  function Probe(): null {
    latest = useMobileNativeChatPinchGesture(scrollGestureEnded).fontScale
    return null
  }

  beforeEach(() => {
    latest = 1
    act(() => {
      renderer = create(createElement(Probe))
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    scrollGestureEnded.mockReset()
  })

  // Why this matters: `renderItem` closes over `fontScale`, so each committed
  // value re-measures every message in the list. Committing raw gesture scales
  // drives hundreds of whole-list re-measures per pinch, and a stray second
  // finger during an ordinary scroll starts that storm at scales the user cannot
  // even see. Those re-measures are what expose the recycled-paragraph repaint
  // that silently drops the tail of a long message.
  it('commits nothing for gesture noise the user cannot see', () => {
    act(() => handlers.start?.())
    for (const scale of [1.001, 0.995, 1.008, 1.02, 0.982]) {
      act(() => handlers.update?.({ scale }))
    }
    expect(latest).toBe(1)
  })

  // The stuck scroll (2026-10-17): gesture-handler cancels a Native gesture whose finger leaves
  // the view (NativeViewGestureHandler's default, GestureHandler.kt:374-376), and the cancel is an
  // ACTION_CANCEL that ReactScrollView answers with no end-drag (ReactScrollView.java:656). The
  // root keeps the rest of the touch, so the list froze under a finger that crossed onto the
  // header or the composer.
  it('keeps scrolling the list when the dragging finger crosses its edge', () => {
    expect(native.cancelsOutside).toBe(false)
  })

  it('tells the list when its scroll gesture ends, and whether it was cancelled', () => {
    expect(native.runOnJS).toBe(true)
    act(() => handlers.finalize?.({}, false))
    act(() => handlers.finalize?.({}, true))
    expect(scrollGestureEnded.mock.calls).toEqual([[true], [false]])
  })

  it('commits a real pinch, on the step grid', () => {
    act(() => handlers.start?.())
    act(() => handlers.update?.({ scale: 1.34 }))
    expect(latest).toBe(1.35)
    act(() => handlers.update?.({ scale: 1.37 }))
    expect(latest).toBe(1.35)
    act(() => handlers.update?.({ scale: 1.42 }))
    expect(latest).toBe(1.4)
  })

  // The Claude app's "Transcript text size" (s230.java:641-652): Small 0.85, Medium 1.0,
  // Large 1.15, applied to the whole transcript. Here it is where the transcript starts, and a
  // pinch still works from it.
  describe('with a text size chosen in Settings', () => {
    afterEach(() => {
      resetChatReadingSettingsForTests()
    })

    async function remount(): Promise<void> {
      act(() => renderer?.unmount())
      await act(async () => {
        renderer = create(createElement(Probe))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    it.each([
      ['small', 0.85],
      ['medium', 1],
      ['large', 1.15]
    ] as const)('starts the transcript at %s: %s', async (size, scale) => {
      resetChatReadingSettingsForTests()
      await saveChatReadingSettings({ textSize: size })
      await remount()
      expect(latest).toBe(scale)
    })

    it('pinches from the chosen size, not from 1', async () => {
      resetChatReadingSettingsForTests()
      await saveChatReadingSettings({ textSize: 'small' })
      await remount()
      act(() => handlers.start?.())
      act(() => handlers.update?.({ scale: 1.4 }))
      // 0.85 x 1.4 = 1.19, on the step grid: 1.2. From 1 it would be 1.4.
      expect(latest).toBe(1.2)
    })

    it('follows the Settings screen while the chat stays open, dropping an earlier pinch', async () => {
      resetChatReadingSettingsForTests()
      await saveChatReadingSettings({ textSize: 'medium' })
      await remount()
      act(() => handlers.start?.())
      act(() => handlers.update?.({ scale: 1.5 }))
      expect(latest).toBe(1.5)
      await act(async () => {
        await saveChatReadingSettings({ textSize: 'large' })
      })
      expect(latest).toBe(1.15)
    })
  })
})

// Structure, not behaviour: the chat must hand the tail-follow owner's gesture-end handler to the
// gesture its list scrolls with, or a cancelled drag is never ended. Comments are stripped so the
// prose above the call cannot satisfy it.
it('ends a cancelled drag through the gesture the chat list scrolls with', () => {
  const source = readFileSync(fileURLToPath(new URL('./MobileNativeChatView.tsx', import.meta.url)), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  expect(code).toMatch(/scrollGestureEnded,?\s[\s\S]*?=\s*useMobileNativeChatTailFollow/)
  expect(code).toMatch(/useMobileNativeChatPinchGesture\(scrollGestureEnded\)/)
})
