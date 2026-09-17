import { cloneElement, createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reduced: false }))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(mocks.reduced)
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
  View: 'View',
  useWindowDimensions: () => ({ width: 440, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'activeOffsetX',
    'activeOffsetY',
    'simultaneousWithExternalGesture',
    'onBegin',
    'onUpdate',
    'onEnd'
  ]) {
    chain[method] = () => chain
  }
  return {
    Gesture: { Pan: () => chain, Native: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
// Shared values hold their target at once and the style worklet is evaluated
// as a plain function, so the drawer's resting transform is what the test
// sees after the enter animation. `interpolate` is the real two-point lerp
// with CLAMP semantics, so travel reads as pixels and not as a stub.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    // One box per mount, as on device: an effect's write survives the next render.
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: () => () => {},
    withSpring: (to: number) => to,
    withTiming: (to: number) => to,
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

import { resetReducedMotionForTests } from '../ui/use-reduced-motion'
import { MountedBottomDrawer } from './mounted-bottom-drawer'
import { RightDrawer } from './RightDrawer'

const noop = () => {}
let renderer: ReactTestRenderer | null = null

/** Mount, then render once more: the enter effect writes `progress` after
 *  the first render, and the mocked style is a plain function of the values
 *  it sees at render time, so the second pass is where the transform settles. */
async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    renderer = create(element)
  })
  // A clone, not the same element: identical props bail out of the render.
  await act(async () => {
    renderer!.update(cloneElement(element))
  })
  return renderer!
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign(
    {},
    ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean)
  )
}

/** The sheet itself: the animated view carrying the drawer's transform. */
function sheetStyle(root: ReactTestInstance, mark: (style: Record<string, unknown>) => boolean) {
  const sheet = root
    .findAllByType('AnimatedView' as never)
    .map((node) => flatten(node.props.style))
    .find(mark)
  expect(sheet).toBeDefined()
  return sheet!
}

function translateOf(style: Record<string, unknown>, axis: 'translateX' | 'translateY') {
  const transform = style.transform as Record<string, number>[]
  return transform.find((entry) => axis in entry)?.[axis]
}

beforeEach(() => {
  resetReducedMotionForTests()
  mocks.reduced = false
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/**
 * Reanimated writes only the keys the worklet returns and never clears one that
 * disappears (`useAnimatedStyle`'s styleUpdater loops `for (const key in
 * newValues)`, with no diff against the previous frame). So a mapping that
 * returns `opacity` under reduced motion and omits it otherwise can strand the
 * view at whatever opacity it last wrote.
 *
 * The path that bites: `useReducedMotion` seeds from a module cache, so a stale
 * `true` renders the first frame at `opacity: progress.value` around 0; the real
 * answer arrives milliseconds later as `false`, the key vanishes, and the drawer
 * sits at zero opacity while fully mounted and interactive under a visible
 * backdrop. That is the dead, dimmed screen `windowEpoch` exists to prevent.
 *
 * Asserting the KEY SET rather than a value is deliberate: the bug is a key that
 * is absent, and no assertion about opacity's value can see an absence. The
 * full-motion cases above read `opacity ?? 1`, which passes either way.
 */
// The setting was honoured by four files and neither drawer was one of them:
// with "Remove animations" on, every sheet still slid up from the bottom and
// every panel still slid in from the right (0.6.6 audit). The gesture code,
// the enter/exit effects and the recorded window hand-back are untouched;
// only the mapping from `progress` to the screen changes, travel → opacity.
describe('the bottom sheet under reduced motion', () => {
  const sheet = () =>
    sheetStyle(renderer!.root, (style) => style.borderTopLeftRadius === 24)

  async function sheetKeys(reduced: boolean) {
    act(() => renderer?.unmount())
    renderer = null
    resetReducedMotionForTests()
    mocks.reduced = reduced
    await render(
      createElement(MountedBottomDrawer, { visible: true, onClose: noop, onHidden: noop }, null)
    )
    return Object.keys(sheet()).sort()
  }

  it('arrives in place and fades, with no travel', async () => {
    mocks.reduced = true
    await render(
      createElement(MountedBottomDrawer, { visible: true, onClose: noop, onHidden: noop }, null)
    )
    expect(translateOf(sheet(), 'translateY')).toBe(0)
    expect(sheet().opacity).toBe(1)
  })

  it('still slides up from below when motion is not reduced', async () => {
    await render(
      createElement(MountedBottomDrawer, { visible: false, onClose: noop, onHidden: noop }, null)
    )
    // Hidden: progress 0 → parked a full screen height below.
    expect(translateOf(sheet(), 'translateY')).toBe(956)
    expect(sheet().opacity ?? 1).toBe(1)
  })

  it('is hidden by opacity, not by parking off-screen, when motion is reduced', async () => {
    mocks.reduced = true
    await render(
      createElement(MountedBottomDrawer, { visible: false, onClose: noop, onHidden: noop }, null)
    )
    expect(translateOf(sheet(), 'translateY')).toBe(0)
    expect(sheet().opacity).toBe(0)
  })

  it('writes the same style keys in both modes, so none can be left stuck', async () => {
    expect(await sheetKeys(true)).toEqual(await sheetKeys(false))
  })
})

describe('the right panel under reduced motion', () => {
  const panel = () => sheetStyle(renderer!.root, (style) => style.height === '100%')

  async function panelKeys(reduced: boolean) {
    act(() => renderer?.unmount())
    renderer = null
    resetReducedMotionForTests()
    mocks.reduced = reduced
    await render(createElement(RightDrawer, { visible: true, onClose: noop }, null))
    return Object.keys(panel()).sort()
  }
  // The wrapper unmounts a never-shown panel, so hide it after showing it:
  // progress goes 1 → 0 and the exit callback (never fired by the mock)
  // leaves it mounted at its hidden position.
  async function showThenHide() {
    const root = await render(createElement(RightDrawer, { visible: true, onClose: noop }, null))
    const hidden = createElement(RightDrawer, { visible: false, onClose: noop }, null)
    await act(async () => {
      root.update(hidden)
    })
    // Once more so the hide effect's write to `progress` is what the style sees.
    await act(async () => {
      root.update(cloneElement(hidden))
    })
  }

  it('arrives in place and fades, with no travel', async () => {
    mocks.reduced = true
    await render(createElement(RightDrawer, { visible: true, onClose: noop }, null))
    expect(translateOf(panel(), 'translateX')).toBe(0)
    expect(panel().opacity).toBe(1)
  })

  it('still parks off the right edge when hidden and motion is not reduced', async () => {
    await showThenHide()
    expect(translateOf(panel(), 'translateX')).toBeGreaterThan(0)
    expect(panel().opacity ?? 1).toBe(1)
  })

  it('is hidden by opacity, not by parking off-screen, when motion is reduced', async () => {
    mocks.reduced = true
    await showThenHide()
    expect(translateOf(panel(), 'translateX')).toBe(0)
    expect(panel().opacity).toBe(0)
  })

  it('writes the same style keys in both modes, so none can be left stuck', async () => {
    expect(await panelKeys(true)).toEqual(await panelKeys(false))
  })
})
