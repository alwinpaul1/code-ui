import type { ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Review of the sheet-spec commit (2026-10-14). The scrim fades on a spring of
// its own now (sheet-spec.ts), but a drag-dismiss only took `progress` and the
// sheet's travel down: the scrim's own value stayed at 1, and the backdrop was
// hidden only by the drag's fade. When the parent refused the close (a sheet
// that is mid-save), the restore put the sheet back at rest in one frame, the
// drag fade jumped to 1, and the 32% scrim appeared in that frame while the
// sheet sprang up from the edge. Before the commit the backdrop rode
// `progress`, which restarted at 0, so it faded in with the sheet.

type Recorded = { kind: string; calls: Record<string, unknown[][]> }

const seam = vi.hoisted(() => ({
  scrim: [] as number[]
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
// UI thread reports an exit that ran to its end. The scrim's spring is told
// apart by its config, and every target it is sent to is recorded.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  const { SHEET_SPEC } = await import('./sheet-spec')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    scrollTo: () => {},
    withSpring: (to: number, config?: unknown) => {
      if (config === SHEET_SPEC.motion.scrim) {
        seam.scrim.push(to)
      }
      return to
    },
    withTiming: (to: number, _config?: unknown, done?: (finished: boolean) => void) => {
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
import { MountedBottomDrawer } from './mounted-bottom-drawer'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  seam.scrim.length = 0
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

/** A fast pull well down past the dismiss line, released. */
function flingDown(pan: Recorded): void {
  const handler = (name: string) => pan.calls[name]![0]![0] as (event?: object) => void
  act(() => {
    handler('onBegin')()
    handler('onUpdate')({ translationY: 700 })
    handler('onEnd')({ translationY: 700, velocityY: 4000 })
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

describe.each(CASES)('%s dragged away while its parent refuses the close', (_name, sheet) => {
  it('fades its scrim out with the drag, and back in with the sheet when it returns', () => {
    const onClose = vi.fn() // refuses: visible stays true
    mount(sheet(onClose))
    expect(seam.scrim, 'the scrim faded in on open').toEqual([1])

    flingDown(handlePan())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(seam.scrim.at(-1), 'the scrim stayed up through the drag-dismiss').toBe(0)

    // The refused close is put back (use-drawer-close-request.ts).
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(seam.scrim.at(-1), 'the scrim came back with the sheet').toBe(1)
  })
})
