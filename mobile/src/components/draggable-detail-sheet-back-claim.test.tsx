import type { ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => {
  // Annotated rather than asserted: the literal alone narrows to 'android' and the tests reassign it.
  const platform: { os: 'ios' | 'android' | 'web' } = { os: 'android' }
  return {
    platform,
    claims: [] as ((() => boolean) | null)[],
    addEventListener: vi.fn(() => ({ remove: () => {} }))
  }
})

// The seam is the unit under observation: which half answers is the bundler's choice, and
// `use-back-claim.web.ts` has its own tests. What this pins is that the sheet goes through it.
vi.mock('../navigation/use-back-claim', () => ({
  useBackClaim: (claim: (() => boolean) | null) => {
    seam.claims.push(claim)
  }
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: seam.addEventListener },
  Modal: 'Modal',
  get Platform() {
    return {
      OS: seam.platform.os,
      select: (options: Record<string, unknown>) => options[seam.platform.os] ?? options.default
    }
  },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  // Every builder method hands the chain back, whatever the sheet calls on it.
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: { Pan: () => chain, Native: () => chain, Simultaneous: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  withSpring: (to: number) => to,
  // The exit animation reports finished at once, so a dismiss reaches `onClose` in the same act.
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
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({
    colors: { textMuted: 'muted', bgOverlay: 'overlay', bgPanel: 'panel' }
  })
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))

import { DraggableDetailSheet } from './DraggableDetailSheet'

function sheet(visible: boolean, onClose: () => void): ReactElement {
  return (
    <DraggableDetailSheet visible={visible} onClose={onClose} header={null}>
      {null}
    </DraggableDetailSheet>
  )
}

function render(visible: boolean, onClose: () => void = () => {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(sheet(visible, onClose))
  })
  return renderer
}

function lastClaim(): (() => boolean) | null | undefined {
  return seam.claims.at(-1)
}

beforeEach(() => {
  seam.platform.os = 'android'
  seam.claims.length = 0
  seam.addEventListener.mockClear()
})

/**
 * The tool-detail sheet is this fork's own, so upstream #22308's sweep of the session sheets never
 * reached it: it still registered the hardware key itself and returned early on web. Inside the
 * shell's page that is the defect #22308 fixed for every other sheet — one Back press left the
 * whole session route with the sheet still open, because nothing on the page claimed the key.
 */
describe('the tool-detail sheet and the device Back key', () => {
  it('claims the key through the shared seam while it is open inside the page', () => {
    seam.platform.os = 'web'
    const renderer = render(true)
    expect(typeof lastClaim()).toBe('function')
    act(() => renderer.unmount())
  })

  it('claims it on Android through the same seam, not a listener of its own', () => {
    const renderer = render(true)
    expect(typeof lastClaim()).toBe('function')
    expect(seam.addEventListener).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('spends the press on closing the sheet', () => {
    const onClose = vi.fn()
    const renderer = render(true, onClose)
    let handled: boolean | undefined
    act(() => {
      handled = lastClaim()?.()
    })
    expect(handled).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })

  it('lets the key go while the sheet animates out', () => {
    const renderer = render(true)
    act(() => renderer.update(sheet(false, () => {})))
    expect(lastClaim()).toBeNull()
    act(() => renderer.unmount())
  })
})
