import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handlers = { onEnd?: (e: object) => void; onUpdate?: (e: object) => void }

const seam = vi.hoisted(() => ({
  timings: [] as { to: number; done?: (finished: boolean) => void }[],
  cells: [] as { value: number }[],
  pans: [] as unknown[]
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { dismiss: () => {} },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {}, absoluteFill: {}, hairlineWidth: 1 },
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const handlers: Handlers = {}
  const chain: Record<string, unknown> = {}
  for (const method of ['activeOffsetX', 'simultaneousWithExternalGesture']) {
    chain[method] = () => chain
  }
  for (const method of ['onUpdate', 'onEnd'] as const) {
    chain[method] = (fn: never) => {
      handlers[method] = fn
      return chain
    }
  }
  return {
    Gesture: {
      Pan: () => {
        seam.pans.push(handlers)
        return chain
      },
      Native: () => ({})
    },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView',
    __handlers: handlers
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) =>
      React.useRef(
        (() => {
          const cell = { value: initial }
          seam.cells.push(cell)
          return cell
        })()
      ).current,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: () => () => {},
    withSpring: (to: number) => to,
    withTiming: (to: number, _config?: unknown, done?: (finished: boolean) => void) => {
      seam.timings.push({ to, done })
      return to
    },
    runOnJS:
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        fn(...args),
    interpolate: () => 0,
    Extrapolation: { CLAMP: 'clamp' }
  }
})

import * as gestureHandler from 'react-native-gesture-handler'
import { RightDrawer } from './RightDrawer'

const handlers = (gestureHandler as unknown as { __handlers: Handlers }).__handlers

function Content(): null {
  return null
}

function drawer(visible: boolean, onClose: () => void = () => {}): ReactElement {
  return createElement(RightDrawer, { visible, onClose, children: createElement(Content) })
}

let renderer: ReactTestRenderer | null = null

function render(element: ReactElement): void {
  act(() => {
    renderer = create(element)
  })
}

function rerender(element: ReactElement): void {
  act(() => renderer!.update(element))
}

function exits() {
  return seam.timings.filter((timing) => timing.to === 0 && timing.done)
}

beforeEach(() => {
  seam.timings.length = 0
  seam.cells.length = 0
  seam.pans.length = 0
  const originalConsoleError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('not configured to support act')) {
      return
    }
    originalConsoleError(...args)
  })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

// The review screen re-renders the drawer whenever its data refreshes. The
// drawer handed its mount effect a new `onHidden` on every render, so each of
// those renders re-ran the effect.
describe('the right drawer while its parent re-renders', () => {
  it('does not snap an open panel back to its rest', () => {
    render(drawer(true))
    const translateX = seam.cells[0]!
    translateX.value = 140 // the finger has dragged it 140 dp

    rerender(drawer(true))

    expect(translateX.value).toBe(140)
  })

  it('does not restart an exit that is running, which a busy parent could then postpone for ever', () => {
    render(drawer(true))
    rerender(drawer(false))
    expect(exits()).toHaveLength(1)

    rerender(drawer(false))
    rerender(drawer(false))

    expect(exits(), 'one exit, however often the parent re-renders').toHaveLength(1)
  })
})

describe('the right drawer dismissed by a swipe', () => {
  function swipeAway(): void {
    act(() => {
      handlers.onUpdate?.({ translationX: 300 })
      handlers.onEnd?.({ translationX: 300, velocityX: 0 })
    })
  }

  it('unmounts when the parent hides it, without running its exit a second time', () => {
    const afterSwipe = { visible: true }
    const onClose = vi.fn(() => {
      afterSwipe.visible = false
    })
    render(drawer(true, onClose))
    swipeAway()
    act(() => exits().at(-1)!.done!(true))
    expect(onClose).toHaveBeenCalledTimes(1)
    const exitsBefore = exits().length

    rerender(drawer(afterSwipe.visible, onClose))

    expect(exits().length, 'no second exit').toBe(exitsBefore)
    expect(renderer!.toJSON(), 'already off the screen: unmounted at once').toBeNull()
  })

  it('does not ask the parent to close from an exit that never finished', () => {
    const onClose = vi.fn()
    render(drawer(true, onClose))
    swipeAway()

    act(() => exits().at(-1)!.done!(false))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('comes back when the parent refuses the close, instead of staying invisible over a live overlay', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn() // refuses: visible stays true
      render(drawer(true, onClose))
      swipeAway()
      act(() => exits().at(-1)!.done!(true))
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(seam.timings.at(-1)?.to, 'animated back in').toBe(1)
      expect(seam.cells[0]!.value, 'at its rest again').toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the gestures it handed gesture-handler when it re-renders', () => {
    render(drawer(true))
    const built = seam.pans.length
    expect(built).toBeGreaterThan(0)
    rerender(drawer(true))
    expect(seam.pans.length).toBe(built)
  })
})
