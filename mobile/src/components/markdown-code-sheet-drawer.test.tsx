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
  springs: [] as unknown[],
  /** What the keyboard reports as the drawer mounts: the chat list keeps taps
   *  `handled`, so Expand opens with the composer's keyboard still up. */
  keyboard: null as { height: number } | null
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {}, metrics: () => mocks.keyboard },
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
  mocks.keyboard = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))

function sheet(onClose: () => void, code = 'pnpm test', visible = true): ReactElement {
  return (
    <ThemeProvider initialPreference="dark">
      <MarkdownCodeSheet visible={visible} language="sh" code={code} onClose={onClose} />
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

  // Review (2026-10-14): the sheet asked the drawer for `fillAvailable` only to
  // make its static body flex. In fill mode the drawer lifts its box by the
  // keyboard's height, and an expandable sheet's box has a fixed full height,
  // so with the composer's keyboard still up the sheet stood a keyboard's
  // height too high, its top (grabber, title, cross, Copy) off the screen.
  it('does not lift the sheet by the keyboard that is still up when Expand is pressed', async () => {
    mocks.keyboard = { height: 320 }
    const tree = await open(sheet(() => {}))
    const [drawn] = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
    )
    expect(flatten(drawn!.props.style).marginBottom ?? 0).toBe(0)
    expect(flatten(drawn!.props.style).height).toBe(956 - 62 - spacing.lg)
  })

  it('still gives its code the sheet’s whole height to fill', async () => {
    const tree = await open(sheet(() => {}))
    const body = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'markdown-code-sheet-body'
    )[0]!
    expect(flatten(body.parent!.props.style).flex).toBe(1)
  })

  // Review (2026-10-14): the cross flips `visible` at once and the drawer plays
  // its 150 ms exit, and the lines were built only while `visible`, so the exit
  // played over an empty body.
  it('keeps the code on screen while the sheet leaves', async () => {
    const element = sheet(() => {})
    const tree = await open(element)
    const runs = (): number =>
      tree.root
        .findAll((node) => typeof node.type === 'string' && node.props.testID === 'markdown-code-sheet-body')[0]!
        .findAll((node) => String(node.type) === 'Text' && node.props.selectable === true).length
    expect(runs()).toBe(1)
    await act(async () => {
      tree.update(sheet(() => {}, 'pnpm test', false))
    })
    expect(runs()).toBe(1)
  })

  // The Claude app's sheet puts the code fill edge to edge; the drawer's own
  // 12 dp side padding left a margin of sheet ground either side of it.
  it('draws the code fill edge to edge and keeps the title row where it was', async () => {
    const tree = await open(sheet(() => {}))
    const [drawn] = tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
    )
    expect(flatten(drawn!.props.style).paddingHorizontal).toBe(0)
    const closeRow = tree.root
      .findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Close')[0]!
    const wrappers = []
    for (let node: ReactTestInstance | null = closeRow.parent; node; node = node.parent) {
      if (String(node.type) === 'View' && flatten(node.props.style).paddingHorizontal !== undefined) {
        wrappers.push(flatten(node.props.style).paddingHorizontal)
      }
    }
    // 12 dp of drawer padding that is gone + the 8 dp the other sheets' title rows keep.
    expect(wrappers).toContain(spacing.md + spacing.sm)
  })
})
