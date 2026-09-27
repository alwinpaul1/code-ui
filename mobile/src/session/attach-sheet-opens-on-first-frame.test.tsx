import { cloneElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reported from the phone on 2026-09-26: "the sheet to upload media files opens
// slow". The composer's + flips one state and the Add context sheet mounts in
// the same commit; nothing is awaited first (no clipboard probe, no media or
// permission query, no thumbnails). What was slow was the slide itself: the
// sheet travelled the whole window height on Reanimated's default ease-in-out,
// so a ~280 dp sheet on a ~950 dp window was still below the screen edge more
// than halfway through its 180 ms open. These tests play that open back frame
// by frame, through the real attach sheet, drawer and theme.

const clock = vi.hoisted(() => ({ now: 0 }))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: {
    addListener: () => ({ remove: () => {} }),
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
vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  ChevronRight: 'ChevronRight',
  Image: 'Image',
  Paperclip: 'Paperclip',
  Zap: 'Zap'
}))

// A shared value that is a real timeline: `withTiming` hands back the curve it
// was asked for, and reading `.value` evaluates that curve at `clock.now`, from
// wherever the value stood when the animation was assigned. The curve is
// Reanimated's own default when the caller names none (Easing.inOut(Easing.quad),
// react-native-reanimated/src/animation/timing.ts), so an unconfigured open is
// played back the way the device plays it.
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

import { resetReducedMotionForTests } from '../ui/use-reduced-motion'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'

/** A 60 Hz frame; the S23 the report came from runs at 120 Hz, so this is generous. */
const FRAME_MS = 1000 / 60
/** The attach sheet's height with its permission row, about what the device lays out. */
const SHEET_HEIGHT = 280
const WINDOW_HEIGHT = 956

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  clock.now = 0
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function sheetIn(scheme: 'light' | 'dark', visible: boolean): ReactElement {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileNativeChatAttachSheet
        visible={visible}
        onClose={() => {}}
        onCaptureImage={() => {}}
        onAttachImage={() => {}}
        onAttachFile={() => {}}
        permissionMode="default"
        onOpenPermission={() => {}}
      />
    </ThemeProvider>
  )
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))
}

function sheetNode(): ReactTestInstance {
  const [sheet] = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
  )
  expect(sheet, 'the attach sheet did not mount').toBeDefined()
  return sheet!
}

/** How much of the sheet is above the bottom edge of the window, in dp. */
function onScreenHeight(): number {
  const transform = flatten(sheetNode().props.style).transform as Record<string, number>[]
  const translateY = transform.find((entry) => 'translateY' in entry)?.translateY ?? 0
  return Math.max(0, SHEET_HEIGHT - translateY)
}

/** The + tap: the composer flips `showAttachSheet`, and the sheet lays itself out. */
async function tapPlus(scheme: 'light' | 'dark'): Promise<void> {
  await act(async () => {
    renderer = create(sheetIn(scheme, false))
  })
  await act(async () => {
    renderer!.update(sheetIn(scheme, true))
  })
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 412, height: SHEET_HEIGHT } } }
  act(() => {
    ;(sheetNode().props.onLayout as ((event: typeof layout) => void) | undefined)?.(layout)
  })
}

/** Paint the frame `ms` after the open started. */
async function frameAt(scheme: 'light' | 'dark', ms: number): Promise<void> {
  clock.now = ms
  await act(async () => {
    renderer!.update(cloneElement(sheetIn(scheme, true)))
  })
}

describe.each(['light', 'dark'] as const)('the Add context sheet in %s mode', (scheme) => {
  it('is on screen from the first frame after the + tap', async () => {
    await tapPlus(scheme)
    await frameAt(scheme, FRAME_MS)
    expect(onScreenHeight(), 'nothing of the sheet showed on the first frame of its open').toBeGreaterThan(
      SHEET_HEIGHT * 0.1
    )
  })

  it('is mostly up halfway through its open, not still below the screen', async () => {
    await tapPlus(scheme)
    await frameAt(scheme, 90)
    expect(onScreenHeight()).toBeGreaterThan(SHEET_HEIGHT * 0.75)
  })

  it('rests fully open once the open has run', async () => {
    await tapPlus(scheme)
    await frameAt(scheme, 1000)
    expect(onScreenHeight()).toBe(SHEET_HEIGHT)
  })

  it('draws on this theme’s panel ground', async () => {
    await tapPlus(scheme)
    expect(flatten(sheetNode().props.style).backgroundColor).toBe(colorsForScheme(scheme).bgPanel)
  })
})

describe('the Add context sheet before it has measured itself', () => {
  it('waits below the screen edge rather than flashing in at its resting place', async () => {
    await act(async () => {
      renderer = create(sheetIn('light', false))
    })
    await act(async () => {
      renderer!.update(sheetIn('light', true))
    })
    // No layout yet: the only safe distance is the whole window.
    const transform = flatten(sheetNode().props.style).transform as Record<string, number>[]
    expect(transform.find((entry) => 'translateY' in entry)?.translateY).toBe(WINDOW_HEIGHT)
  })
})
