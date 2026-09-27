// Review of a81dfa20 (2026-09-26), failing there: a sheet that travels only
// its own height on close left the part the keyboard had lifted on screen.
import { cloneElement, createElement, type ComponentProps, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Review probe for a81dfa20. A sheet lifted over the keyboard, closed by a
// backdrop tap (or Back): where does it end the close?
//

const clock = vi.hoisted(() => ({ now: 0 }))
const keyboard = vi.hoisted(() => ({
  listeners: new Map<string, (event: { endCoordinates: { height: number }; duration: number }) => void>()
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: {
    addListener: (name: string, fn: (event: { endCoordinates: { height: number }; duration: number }) => void) => {
      keyboard.listeners.set(name, fn)
      return { remove: () => keyboard.listeners.delete(name) }
    },
    dismiss: () => {},
    metrics: () => null
  },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    absoluteFill: {},
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['activeOffsetX', 'activeOffsetY', 'simultaneousWithExternalGesture', 'onBegin', 'onUpdate', 'onEnd']) {
    chain[method] = () => chain
  }
  return {
    Gesture: { Pan: () => chain, Native: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
// The timeline from attach-sheet-opens-on-first-frame.test.tsx: `withTiming`
// returns its curve and `.value` reads it at `clock.now`.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  type Timing = { timing: true; to: number; duration: number; easing: (t: number) => number }
  const inOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
  const isTiming = (value: unknown): value is Timing =>
    typeof value === 'object' && value !== null && (value as Timing).timing === true
  function timeline(initial: number) {
    let from = initial
    let animation: Timing | null = null
    let startedAt = 0
    const read = (): number => {
      if (!animation) {
        return from
      }
      const t = Math.min(Math.max((clock.now - startedAt) / animation.duration, 0), 1)
      return from + (animation.to - from) * animation.easing(t)
    }
    return {
      get value(): number {
        return read()
      },
      set value(next: number | Timing) {
        if (isTiming(next)) {
          from = read()
          animation = next
          startedAt = clock.now
        } else {
          from = next
          animation = null
        }
      }
    }
  }
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef(timeline(initial)).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: () => () => {},
    withTiming: (to: number, config?: { duration?: number; easing?: (t: number) => number }) => ({
      timing: true,
      to,
      duration: config?.duration ?? 300,
      easing: config?.easing ?? inOutQuad
    }),
    withSpring: (to: number) => to,
    runOnJS: (fn: () => void) => fn,
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.min(Math.max((value - input[0]) / (input[1] - input[0]), 0), 1)
      return output[0] + (output[1] - output[0]) * t
    },
    Extrapolation: { CLAMP: 'clamp' }
  }
})
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 440 })
}))
vi.mock('./bottom-drawer-modal-host', () => ({
  useInsideBottomDrawerModalHost: () => true
}))

import { MountedBottomDrawer as Drawer } from './mounted-bottom-drawer'
import { resetReducedMotionForTests } from '../ui/use-reduced-motion'

/** A rename / password sheet: handle, title, one field, two buttons. */
const SHEET = 280
/** Gboard / Samsung keyboard on a 412 dp wide phone. */
const KEYBOARD = 300

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  visibleProp = true
  clock.now = 0
  keyboard.listeners.clear()
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

let visibleProp = true
// Stable, as BottomDrawer's own handleHidden is: a fresh onHidden per render
// re-runs the drawer's enter effect on every frame.
const onClose = () => {}
const onHidden = () => {}
function element(fillAvailable: boolean): ReactElement {
  const props = { visible: visibleProp, onClose, onHidden, fillAvailable } as unknown as ComponentProps<typeof Drawer>
  return createElement(Drawer, props, createElement('View', { testID: 'field' }))
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))
}

function sheetNode(): ReactTestInstance {
  const [sheet] = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
  )
  return sheet!
}

function sheetStyle(): Record<string, unknown> {
  return flatten(sheetNode().props.style)
}

/** The native layout pass reporting the sheet's box (what the device sends). */
function layout(height: number): void {
  act(() => {
    ;(sheetNode().props.onLayout as ((event: unknown) => void) | undefined)?.({
      nativeEvent: { layout: { x: 0, y: 0, width: 412, height } }
    })
  })
}

async function frameAt(ms: number, fillAvailable: boolean): Promise<void> {
  clock.now = ms
  await act(async () => {
    renderer!.update(cloneElement(element(fillAvailable)))
  })
}

/**
 * How much of the sheet is above the bottom edge of the WINDOW, in dp. The box
 * is bottom-anchored, lifted by `marginBottom` (fill sheets), and `height` is
 * its laid-out height; translateY moves it down from there.
 */
function onScreen(boxHeight: number): number {
  const style = sheetStyle()
  const transform = style.transform as Record<string, number>[]
  const translateY = transform.find((entry) => 'translateY' in entry)?.translateY ?? 0
  const marginBottom = (style.marginBottom as number | undefined) ?? 0
  return Math.max(0, marginBottom + boxHeight - translateY)
}

function fire(name: 'keyboardDidShow' | 'keyboardDidHide', height: number): void {
  const listener = keyboard.listeners.get(name)
  expect(listener, `${name} listener`).toBeDefined()
  act(() => listener!({ endCoordinates: { height }, duration: 0 }))
}

function tapBackdrop(): void {
  const backdrop = renderer!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && typeof node.props.onPress === 'function'
  )[0]
  expect(backdrop, 'backdrop pressable').toBeDefined()
  act(() => backdrop!.props.onPress())
}

describe(`a content-sized sheet over the keyboard, closed by a backdrop tap`, () => {
  async function openWithKeyboard(): Promise<void> {
    await act(async () => {
      renderer = create(element(false))
    })
    layout(SHEET)
    await frameAt(1000, false)
    fire('keyboardDidShow', KEYBOARD)
    await frameAt(2000, false)
    expect(onScreen(SHEET), 'sheet should rest fully open above the keys').toBe(SHEET + KEYBOARD)
  }

  it('is off the screen when the close ends, before keyboardDidHide has arrived', async () => {
    await openWithKeyboard()
    tapBackdrop()
    // BOTTOM_DRAWER_HIDE_DURATION_MS is 150: the last frame of the close, when
    // the backdrop is fully gone and onClose runs.
    await frameAt(2150, false)
    expect(onScreen(SHEET), 'dp of the sheet still above the screen edge at the end of its close').toBe(0)
  })

  it('is off the screen when the close ends, even if keyboardDidHide arrived with the tap', async () => {
    await openWithKeyboard()
    tapBackdrop()
    fire('keyboardDidHide', 0) // the earliest it can come: same frame as the tap
    await frameAt(2150, false)
    expect(onScreen(SHEET), 'dp of the sheet still above the screen edge at the end of its close').toBe(0)
  })
})

describe(`a fill sheet with a docked field, closed by a backdrop tap while typing`, () => {
  it('is off the screen when the close ends, before keyboardDidHide has arrived', async () => {
    await act(async () => {
      renderer = create(element(true))
    })
    layout(sheetStyle().height as number)
    await frameAt(1000, true)
    fire('keyboardDidShow', KEYBOARD)
    await frameAt(1001, true)
    // The fill sheet shrinks by the keyboard and lifts by marginBottom; the
    // device then reports that new box.
    const boxHeight = sheetStyle().height as number
    layout(boxHeight)
    await frameAt(2000, true)
    expect(sheetStyle().marginBottom).toBe(KEYBOARD)
    expect(onScreen(boxHeight), 'fill sheet should rest fully open above the keys').toBe(KEYBOARD + boxHeight)
    tapBackdrop()
    await frameAt(2150, true)
    expect(onScreen(boxHeight), 'dp of the sheet still above the screen edge at the end of its close').toBe(0)
  })

  it('is off the screen in the frame after the parent hides it (onClose ran), before the next onLayout', async () => {
    await act(async () => {
      renderer = create(element(true))
    })
    layout(sheetStyle().height as number)
    await frameAt(1000, true)
    fire('keyboardDidShow', KEYBOARD)
    await frameAt(1001, true)
    layout(sheetStyle().height as number)
    await frameAt(2000, true)
    tapBackdrop()
    await frameAt(2150, true)
    // onClose ran at the end of the close; the parent sets visible=false. The
    // drawer drops keyboardInset, so the box grows back to its keyboard-free
    // height at once; the device reports that box a frame later.
    visibleProp = false
    await frameAt(2167, true)
    const boxHeight = sheetStyle().height as number
    expect(sheetStyle().marginBottom).toBe(0)
    expect(onScreen(boxHeight), 'dp of the sheet above the screen edge after the parent hid it').toBe(0)
  })
})
