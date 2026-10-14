import { cloneElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Expand sheet on a code block, through the REAL drawer (the card's tests
// stub it). What has to hold there is wiring the stub cannot see: the sheet
// opens at full height, draws the grabber (the Claude app's sheet is
// `LargeResizable`, so it has a partial stop and the grabber), keeps the
// drawer's 0.9.139 motion, and puts its code in a static body that owns its
// own scrolls instead of the drawer's list (which stands still until the
// sheet is dragged to its top).

const mocks = vi.hoisted(() => ({
  timings: [] as { to: number; duration: number | undefined }[],
  springs: [] as unknown[]
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {}, metrics: () => null },
  Modal: 'Modal',
  PixelRatio: { get: () => 3, getFontScale: () => 1 },
  Platform: { OS: 'android', Version: 34, select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: { Pan: () => chain, Native: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    cancelAnimation: () => {},
    scrollTo: () => {},
    withSpring: (to: number, config?: unknown) => {
      mocks.springs.push(config)
      return to
    },
    withTiming: (to: number, config?: { duration?: number }) => {
      mocks.timings.push({ to, duration: config?.duration })
      return to
    },
    runOnJS: (fn: () => void) => fn,
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.min(Math.max((value - input[0]) / (input[1] - input[0]), 0), 1)
      return output[0] + (output[1] - output[0]) * t
    },
    Extrapolation: { CLAMP: 'clamp' }
  }
})
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))
vi.mock('./bottom-drawer-modal-host', () => ({ useInsideBottomDrawerModalHost: () => true }))

import { MarkdownCodeSheet } from './MobileMarkdownCodeSheet'
import { SHEET_SPEC } from './sheet-spec'
import { ThemeProvider } from '../theme/theme-context'
import { spacing } from '../theme/mobile-theme'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  mocks.timings.length = 0
  mocks.springs.length = 0
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))

function sheet(onClose: () => void, code = 'pnpm test'): ReactElement {
  return (
    <ThemeProvider initialPreference="dark">
      <MarkdownCodeSheet visible language="sh" code={code} onClose={onClose} />
    </ThemeProvider>
  )
}

async function open(element: ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(element)
  })
  const [laidOut] = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
  )
  act(() => {
    laidOut?.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 894 } } })
  })
  await act(async () => {
    renderer!.update(cloneElement(element))
  })
  return renderer!
}

const hosts = (root: ReactTestInstance, type: string): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === type)

describe('the Expand sheet in the real drawer', () => {
  it('opens at the full height under the status bar, not at the drawer’s part-way height', async () => {
    const tree = await open(sheet(() => {}))
    const [drawn] = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
    )
    expect(flatten(drawn!.props.style).height).toBe(956 - 62 - spacing.lg)
  })

  it('draws the grabber bar, since the app’s code sheet has a partial stop', async () => {
    const tree = await open(sheet(() => {}))
    const bars = hosts(tree.root, 'View')
      .map((node) => flatten(node.props.style))
      .filter((style) => style.width === SHEET_SPEC.handle.width && style.height === SHEET_SPEC.handle.height && style.backgroundColor)
    expect(bars).toHaveLength(1)
  })

  it('puts the title row above the code, the cross on its left and Copy on its right', async () => {
    const tree = await open(sheet(() => {}))
    const labels = hosts(tree.root, 'Pressable').map((node) => String(node.props.accessibilityLabel))
    expect(labels.indexOf('Close')).toBeGreaterThanOrEqual(0)
    expect(labels.indexOf('Close')).toBeLessThan(labels.indexOf('Copy to clipboard'))
    const body = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'markdown-code-sheet-body'
    )
    expect(body).toHaveLength(1)
    // The code is in the sheet's static body, not inside the drawer's list.
    expect(hosts(tree.root, 'AnimatedScrollView')).toHaveLength(0)
    expect(hosts(body[0]!, 'ScrollView').some((node) => node.props.horizontal === true)).toBe(true)
  })

  it('calls onClose from the cross', async () => {
    const onClose = vi.fn()
    const tree = await open(sheet(onClose))
    const close = hosts(tree.root, 'Pressable').find((node) => node.props.accessibilityLabel === 'Close')
    act(() => close!.props.onPress())
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the drawer’s own motion: the 180 ms timed open and no spring from rest', async () => {
    await open(sheet(() => {}))
    expect(mocks.timings).toContainEqual({ to: 1, duration: SHEET_SPEC.motion.openMs })
    expect(mocks.springs).toEqual([])
  })

  // The degenerate sizes: one blank line of code, and a very long one.
  it('opens on an empty block with no Copy and an empty body', async () => {
    const tree = await open(sheet(() => {}, ''))
    const labels = hosts(tree.root, 'Pressable').map((node) => String(node.props.accessibilityLabel))
    expect(labels).toContain('Close')
    expect(labels).not.toContain('Copy to clipboard')
  })

  it('draws a very long block whole, a Text for every 24 lines', async () => {
    const code = Array.from({ length: 5_000 }, (_, index) => `line ${index}`).join('\n')
    const tree = await open(sheet(() => {}, code))
    const body = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'markdown-code-sheet-body'
    )[0]!
    const runs = hosts(body, 'Text').filter((node) => node.props.selectable === true)
    expect(runs).toHaveLength(Math.ceil(5_000 / 24))
  })
})
