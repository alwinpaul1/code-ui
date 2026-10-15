import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A chat message row turns in-place selection off for everything in it (the Claude app selects
// nothing in its timeline; a hold opens the message's menu). A sheet a row opens — a thought, a
// tool's detail, Select text — is drawn inside that row's tree, so without a reset it inherited
// the row's "off" and its words could not be selected either.

vi.mock('./mounted-bottom-drawer', async () => {
  const React = await import('react')
  return {
    MountedBottomDrawer: ({ children }: { children?: ReactNode }) => React.createElement('MountedBottomDrawer', null, children)
  }
})
vi.mock('react-native', () => ({
  Keyboard: { dismiss: () => {} },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => undefined }))
vi.mock('react-native-gesture-handler', () => {
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
  withTiming: (to: number) => to,
  runOnJS:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' }
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({ colors: { textMuted: 'muted', bgOverlay: 'overlay', bgPanel: 'panel' } })
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))

import { BottomDrawer } from './BottomDrawer'
import { ChatTextInPlaceSelectionContext, useChatTextInPlaceSelection } from './chat-text-selectable-context'
import { DraggableDetailSheet } from './DraggableDetailSheet'

const seen: boolean[] = []
function Probe(): null {
  seen.push(useChatTextInPlaceSelection())
  return null
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  seen.length = 0
})

function insideRow(sheet: ReactNode): void {
  act(() => {
    renderer = create(createElement(ChatTextInPlaceSelectionContext.Provider, { value: false }, createElement(Probe), sheet))
  })
}

describe('a sheet opened from a chat row selects in place, though the row does not', () => {
  it('as a bottom drawer (a thought, Select text)', () => {
    insideRow(
      <BottomDrawer visible onClose={() => undefined}>
        <Probe />
      </BottomDrawer>
    )
    expect(seen.at(0)).toBe(false)
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.slice(1).every(Boolean)).toBe(true)
  })

  it('as a detail sheet (a tool’s detail)', () => {
    insideRow(
      <DraggableDetailSheet visible onClose={() => undefined} header={null}>
        <Probe />
      </DraggableDetailSheet>
    )
    expect(seen.at(0)).toBe(false)
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.slice(1).every(Boolean)).toBe(true)
  })
})
