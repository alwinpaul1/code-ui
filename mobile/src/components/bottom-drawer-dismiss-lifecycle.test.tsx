import { createElement, useState, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Timing = { timing: true; to: number; done?: (finished: boolean) => void }
type Handlers = { onBegin?: () => void; onUpdate?: (e: object) => void; onEnd?: (e: object) => void }

const seam = vi.hoisted(() => ({
  timings: [] as { to: number; done?: (finished: boolean) => void }[],
  cells: [] as { value: number; plainWrites: number[]; settle: () => void }[],
  pans: [] as Handlers[],
  keyboard: new Map<string, (event: { endCoordinates: { height: number }; duration: number }) => void>()
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: {
    addListener: (
      name: string,
      fn: (event: { endCoordinates: { height: number }; duration: number }) => void
    ) => {
      seam.keyboard.set(name, fn)
      return { remove: () => seam.keyboard.delete(name) }
    },
    dismiss: () => {},
    metrics: () => null
  },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
  View: 'View',
  useWindowDimensions: () => ({ width: 440, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const pan = () => {
    const handlers: Handlers = {}
    seam.pans.push(handlers)
    const chain: Record<string, unknown> = {}
    for (const method of ['activeOffsetY', 'simultaneousWithExternalGesture', 'onFinalize']) {
      chain[method] = () => chain
    }
    for (const method of ['onBegin', 'onUpdate', 'onEnd'] as const) {
      chain[method] = (fn: never) => {
        handlers[method] = fn
        return chain
      }
    }
    return chain
  }
  const native = () => ({})
  return {
    Gesture: { Pan: pan, Native: native },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
// A shared value is one cell per call site. A number written to it lands at once;
// a withTiming() object is an animation the test finishes by hand (its callback), so a
// test can tell "snapped to 0" from "animating to 0".
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  const isTiming = (value: unknown): value is Timing =>
    typeof value === 'object' && value !== null && (value as Timing).timing === true
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) =>
      React.useRef(
        (() => {
          let value = initial
          const plainWrites: number[] = []
          let target: number | null = null
          const cell = {
            get value() {
              return value
            },
            set value(next: number | Timing) {
              if (isTiming(next)) {
                target = next.to
              } else {
                value = next
                plainWrites.push(next)
                target = null
              }
            },
            plainWrites,
            settle() {
              if (target !== null) {
                value = target
                target = null
              }
            }
          }
          seam.cells.push(cell as unknown as (typeof seam.cells)[number])
          return cell
        })()
      ).current,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    scrollTo: () => {},
    runOnUI: (fn: () => void) => fn,
    withSpring: (to: number) => to,
    withTiming: (to: number, _config?: unknown, done?: (finished: boolean) => void) => {
      seam.timings.push({ to, done })
      return { timing: true, to, done }
    },
    runOnJS:
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        fn(...args),
    interpolate: () => 0,
    Extrapolation: { CLAMP: 'clamp' }
  }
})

import { BottomDrawer } from './BottomDrawer'
import { MountedBottomDrawer } from './mounted-bottom-drawer'

const KEYBOARD = 300

function Content(): null {
  return null
}

function drawer(props: {
  visible: boolean
  onClose: () => void
  onHidden: () => void
  expandable?: boolean
}) {
  return createElement(MountedBottomDrawer, props as ComponentProps<typeof MountedBottomDrawer>, createElement(Content))
}

let renderer: ReactTestRenderer | null = null

function render(props: Parameters<typeof drawer>[0]): ReactTestRenderer {
  act(() => {
    renderer = create(drawer(props))
  })
  return renderer!
}

function tapBackdrop(): void {
  const backdrop = renderer!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && typeof node.props.onPress === 'function'
  )[0]
  expect(backdrop, 'backdrop pressable').toBeDefined()
  act(() => backdrop!.props.onPress())
}

/** The exit animation the sheet last started, which the UI thread finishes. */
function lastHide() {
  const hide = seam.timings.findLast((timing) => timing.to === 0 && timing.done)
  expect(hide, 'an exit animation was started').toBeDefined()
  return hide!
}

beforeEach(() => {
  seam.timings.length = 0
  seam.cells.length = 0
  seam.pans.length = 0
  seam.keyboard.clear()
  vi.useFakeTimers()
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a bottom sheet closed by a backdrop tap, Back or a drag', () => {
  it('is unmounted the moment the parent hides it, without a second exit animation', () => {
    const onHidden = vi.fn()
    // A parent that closes in onClose, as every caller does: its state change
    // and the sheet's own bookkeeping land in the same render.
    function Parent() {
      const [visible, setVisible] = useState(true)
      return drawer({ visible, onClose: () => setVisible(false), onHidden })
    }
    act(() => {
      renderer = create(createElement(Parent))
    })

    tapBackdrop()
    const exits = () => seam.timings.filter((timing) => timing.to === 0 && timing.done).length
    const exitsBefore = exits()
    act(() => lastHide().done!(true))

    // The sheet already left the screen: a second 150 ms of the same animation
    // kept an invisible Modal over the app, and held back onAfterClose.
    expect(exits(), 'no second exit animation').toBe(exitsBefore)
    expect(onHidden).toHaveBeenCalledTimes(1)
  })

  it('comes back when the parent refuses to close it, instead of staying invisible over a live overlay', () => {
    const onClose = vi.fn() // e.g. "not while it is saving": visible stays true
    const onHidden = vi.fn()
    render({ visible: true, onClose, onHidden })

    tapBackdrop()
    act(() => lastHide().done!(true))
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    // Progress 0 with visible=true is a sheet nobody can see and a backdrop
    // that still takes every tap. It has to be put back.
    expect(seam.timings.at(-1)?.to, 'the sheet is animated back in').toBe(1)
    expect(onHidden).not.toHaveBeenCalled()
  })

  it('does not come back when the parent does close it', () => {
    function Parent() {
      const [visible, setVisible] = useState(true)
      return drawer({ visible, onClose: () => setVisible(false), onHidden: vi.fn() })
    }
    act(() => {
      renderer = create(createElement(Parent))
    })
    tapBackdrop()
    act(() => lastHide().done!(true))
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(seam.timings.filter((timing) => timing.to === 1).length, 'only the opening animation').toBe(1)
  })
})

function pressBack(): void {
  const modal = renderer!.root.findAll((node) => String(node.type) === 'Modal')[0]
  expect(modal, 'the sheet owns a Modal').toBeDefined()
  act(() => modal!.props.onRequestClose())
}

// The sheet's Modal keeps answering Back after `visible` went false (the Back
// claim lets go, the Modal's own onRequestClose does not). That Back started a
// new exit, which cancelled the parent's: its callback saw finished=false, so
// the sheet never reported hidden, and the finished Back exit asked a parent
// that had already closed. The sheet stayed mounted at progress 0, an invisible
// Modal that took every tap and every later Back, and onAfterClose never ran.
describe('Back pressed while the parent is already closing a bottom sheet', () => {
  it('leaves the parent\'s exit running, so the sheet still reaches hidden', () => {
    const onHidden = vi.fn()
    render({ visible: true, onClose: vi.fn(), onHidden })
    act(() => renderer!.update(drawer({ visible: false, onClose: vi.fn(), onHidden })))
    const parentExit = lastHide()
    const exitsBefore = seam.timings.filter((timing) => timing.to === 0 && timing.done).length

    pressBack()

    expect(
      seam.timings.filter((timing) => timing.to === 0 && timing.done).length,
      'Back starts no second exit'
    ).toBe(exitsBefore)
    act(() => parentExit.done!(true))
    expect(onHidden).toHaveBeenCalledTimes(1)
  })

  it('still hands off through onAfterClose (the run sheet to the detail sheet)', () => {
    const afterClose = vi.fn()
    function Parent({ visible }: { visible: boolean }) {
      return createElement(BottomDrawer, {
        visible,
        onClose: () => {},
        onAfterClose: afterClose
      } as unknown as ComponentProps<typeof BottomDrawer>, createElement(Content))
    }
    act(() => {
      renderer = create(createElement(Parent, { visible: true }))
    })
    act(() => renderer!.update(createElement(Parent, { visible: false })))

    pressBack()
    // A newer exit cancels the one before it, as Reanimated does: only the
    // last one started runs to its end.
    const exitsStarted = seam.timings.filter((t) => t.to === 0 && t.done)
    for (const timing of exitsStarted) {
      act(() => timing.done!(timing === exitsStarted.at(-1)))
    }

    expect(renderer!.toJSON()).toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })
})

describe('a bottom sheet the parent closes on its own', () => {
  it('stays mounted until its exit animation has finished, not merely been interrupted', () => {
    const onHidden = vi.fn()
    const onClose = vi.fn()
    render({ visible: true, onClose, onHidden })
    act(() => renderer!.update(drawer({ visible: false, onClose, onHidden })))

    act(() => lastHide().done!(false))
    expect(onHidden).not.toHaveBeenCalled()

    act(() => lastHide().done!(true))
    expect(onHidden).toHaveBeenCalledTimes(1)
  })
})

describe('a drag-dismiss whose animation is cut short', () => {
  function releasePast(handlers: Handlers, translationY: number) {
    act(() => {
      handlers.onBegin?.()
      handlers.onUpdate?.({ translationY })
      handlers.onEnd?.({ translationY, velocityY: 0 })
    })
  }

  it('does not ask the parent to close from an animation that never finished', () => {
    const onClose = vi.fn()
    render({ visible: true, onClose, onHidden: vi.fn() })
    releasePast(seam.pans[0]!, 300)

    act(() => lastHide().done!(false))
    expect(onClose, 'a cancelled exit is not a close').not.toHaveBeenCalled()

    act(() => lastHide().done!(true))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does the same for a sheet that opens part way (the run sheet)', () => {
    const onClose = vi.fn()
    render({ visible: true, onClose, onHidden: vi.fn(), expandable: true })
    releasePast(seam.pans[0]!, 600)

    act(() => lastHide().done!(false))
    expect(onClose).not.toHaveBeenCalled()

    act(() => lastHide().done!(true))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('a bottom sheet closed by its parent while the keyboard is up', () => {
  it('does not drop by the keyboard height in one frame as the close begins', () => {
    const onClose = vi.fn()
    const onHidden = vi.fn()
    render({ visible: true, onClose, onHidden })
    const keyboardOffset = seam.cells[2]!
    act(() => seam.keyboard.get('keyboardDidShow')!({ endCoordinates: { height: KEYBOARD }, duration: 250 }))
    keyboardOffset.settle()
    expect(keyboardOffset.value, 'the sheet rides the keyboard').toBeGreaterThan(0)
    const lifted = keyboardOffset.value

    act(() => renderer!.update(drawer({ visible: false, onClose, onHidden })))

    // The lift was set to 0 outright as the close began, so the sheet fell the
    // whole height of the keyboard before it started to leave.
    expect(keyboardOffset.value).toBe(lifted)
    expect(keyboardOffset.plainWrites.at(-1)).not.toBe(0)
  })
})
