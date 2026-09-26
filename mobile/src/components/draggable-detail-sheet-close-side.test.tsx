import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }))

vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('react-native', () => ({
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
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
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  withSpring: (to: number) => to,
  withTiming: (to: number) => to,
  runOnJS: (fn: unknown) => fn,
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' }
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../theme/theme-context', async () => {
  const { darkColors, lightColors } = await import('../theme/tokens')
  return { useTheme: () => ({ colors: seam.scheme === 'dark' ? darkColors : lightColors }) }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))

import { darkColors, lightColors } from '../theme/tokens'
import { DraggableDetailSheet } from './DraggableDetailSheet'

// 2026-09-26 screenshots: the Claude app's tool sheet puts its close cross on
// the LEFT, with the title centred across the sheet; Code UI's sat on the right.
describe('the tool-detail sheet close cross', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('sits on the left, in the theme muted colour (%s)', (scheme, colors) => {
    seam.scheme = scheme
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <DraggableDetailSheet visible onClose={() => {}} header={null}>
          {null}
        </DraggableDetailSheet>
      )
    })
    const close = renderer.root.findByProps({ testID: 'draggable-detail-sheet-close' })
    const style = close.props.style as { left?: number; right?: number }
    expect(typeof style.left).toBe('number')
    expect(style.right).toBeUndefined()
    expect(close.findByType('X' as never).props.color).toBe(colors.textMuted)
    act(() => renderer.unmount())
  })
})
