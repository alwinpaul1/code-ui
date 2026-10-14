import type { ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-10-14: the Claude-app port moved the sheets onto Claude's M3 springs
// (open, drag settle, a scrim on a spring of its own). The user rejected it
// the same day: "We need it smooth same as we have in latest release in git",
// 0.9.139 (237ce4dca). These pin what a DRAG does in 0.9.139 for every sheet
// family: a release short of the dismiss line settles on DRAWER_SPRING (ratio
// 1, k 400, mass 1), and a drag-dismiss the parent refuses comes back on the
// 180 ms open timing, its scrim riding that open. The ported springs fail
// both. The open, hide and reduced motion are pinned in sheet-spec.test.tsx.

type Recorded = { kind: string; calls: Record<string, unknown[][]> }

const seam = vi.hoisted(() => ({
  springs: [] as { to: number; config: unknown }[],
  timings: [] as { to: number; duration: number | undefined }[]
}))

vi.mock('react-native-gesture-handler', () => {
  const builder = (kind: string): unknown => {
    const calls: Record<string, unknown[][]> = {}
    const self: unknown = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === 'kind') {
            return kind
          }
          if (key === 'calls') {
            return calls
          }
          return (...args: unknown[]) => {
            ;(calls[String(key)] ??= []).push(args)
            return self
          }
        }
      }
    )
    return self
  }
  return {
    Gesture: { Pan: () => builder('pan'), Native: () => builder('native') },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {}, metrics: () => null },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
// Values land at once; a timing's completion fires at once, finished, as the
// UI thread reports an exit that ran to its end. Every spring and timing is
// recorded with its config.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    scrollTo: () => {},
    withSpring: (to: number, config?: unknown) => {
      seam.springs.push({ to, config })
      return to
    },
    withTiming: (to: number, config?: { duration?: number }, done?: (finished: boolean) => void) => {
      seam.timings.push({ to, duration: config?.duration })
      done?.(true)
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
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('../theme/theme-context', async () => {
  const { lightColors } = await import('../theme/tokens')
  return {
    useTheme: () => ({ colors: lightColors }),
    useThemedStyles: <T,>(factory: (theme: { colors: typeof lightColors }) => T) => factory({ colors: lightColors })
  }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))
vi.mock('./bottom-drawer-modal-host', () => ({ useInsideBottomDrawerModalHost: () => true }))

import { DraggableDetailSheet } from './DraggableDetailSheet'
import { DRAWER_SPRING } from './drawer-spring'
import { MountedBottomDrawer } from './mounted-bottom-drawer'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  seam.springs.length = 0
  seam.timings.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function mount(element: ReactElement): void {
  act(() => {
    renderer = create(element)
  })
  const [sheet] = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
  )
  act(() => {
    sheet?.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 300 } } })
  })
}

/** The drag the sheet's handle (the first Pan with an end) takes. */
function handlePan(): Recorded {
  const pans = renderer!.root
    .findAll((node: ReactTestInstance) => String(node.type) === 'GestureDetector')
    .map((node) => node.props.gesture as Recorded)
    .filter((gesture) => gesture.kind === 'pan' && gesture.calls.onEnd)
  expect(pans.length, 'no draggable handle').toBeGreaterThan(0)
  return pans[0]!
}

/** A pull of `translationY`, released at `velocityY`. */
function drag(pan: Recorded, translationY: number, velocityY: number): void {
  const handler = (name: string) => pan.calls[name]![0]![0] as (event?: object) => void
  act(() => {
    handler('onBegin')()
    handler('onUpdate')({ translationY })
    handler('onEnd')({ translationY, velocityY })
  })
}

const CASES = [
  [
    'a bottom drawer',
    (onClose: () => void) => (
      <MountedBottomDrawer visible onClose={onClose} onHidden={() => {}}>
        {null}
      </MountedBottomDrawer>
    )
  ],
  [
    'an expandable bottom drawer',
    (onClose: () => void) => (
      <MountedBottomDrawer visible onClose={onClose} onHidden={() => {}} expandable>
        {null}
      </MountedBottomDrawer>
    )
  ],
  [
    'the tool-detail sheet',
    (onClose: () => void) => (
      <DraggableDetailSheet visible onClose={onClose} header={null}>
        {null}
      </DraggableDetailSheet>
    )
  ]
] as const

describe.each(CASES)('%s dragged, as in 0.9.139', (_name, sheet) => {
  it('settles back on the drawer spring when let go short of the dismiss line', () => {
    mount(sheet(() => {}))
    seam.springs.length = 0
    drag(handlePan(), 20, 0)
    expect(seam.springs.length, 'no settle').toBeGreaterThan(0)
    expect(seam.springs.every((call) => call.config === DRAWER_SPRING)).toBe(true)
  })

  it('comes back on the 180 ms open timing when its parent refuses a drag-dismiss', () => {
    const onClose = vi.fn() // refuses: visible stays true
    mount(sheet(onClose))
    seam.springs.length = 0
    seam.timings.length = 0
    drag(handlePan(), 700, 4000)
    expect(onClose).toHaveBeenCalledTimes(1)
    // The refused close is put back (use-drawer-close-request.ts).
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(seam.timings.at(-1)).toEqual({ to: 1, duration: 180 })
    expect(seam.springs.filter((call) => call.to === 1), 'a spring took part in the return').toEqual([])
  })
})
