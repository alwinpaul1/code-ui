import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const springs = vi.hoisted(() => ({ calls: [] as { to: number; config: unknown }[] }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s }
}))

// The shared reanimated double throws the spring config away. This one keeps
// it, so the test can see which spring the press actually runs on.
vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: <T,>(initial: T) => ({ value: initial }),
  useAnimatedStyle: <T,>(factory: () => T) => factory(),
  withSpring: (to: number, config: unknown) => {
    springs.calls.push({ to, config })
    return to
  }
}))

import { PressScale } from './PressScale'
import { dampingRatio, PRESS_IN_SPRING, PRESS_OUT_SPRING } from './press-scale-motion'

function render(props: Parameters<typeof PressScale>[0]): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(PressScale, props))
  })
  return renderer!
}

beforeEach(() => {
  springs.calls = []
})

describe('PressScale', () => {
  it('runs the press-in spring on the way down and the release spring on the way up', () => {
    const renderer = render({})
    const pressable = renderer.root.findByType('Pressable' as never)
    act(() => pressable.props.onPressIn({}))
    act(() => pressable.props.onPressOut({}))
    expect(springs.calls).toEqual([
      { to: 1, config: PRESS_IN_SPRING },
      { to: 0, config: PRESS_OUT_SPRING }
    ])
  })

  it('so a button no longer overshoots in either direction', () => {
    const renderer = render({})
    const pressable = renderer.root.findByType('Pressable' as never)
    act(() => pressable.props.onPressIn({}))
    act(() => pressable.props.onPressOut({}))
    for (const { config } of springs.calls) {
      expect(dampingRatio(config as typeof PRESS_IN_SPRING)).toBeCloseTo(1, 6)
    }
  })

  it('does not scale a disabled surface on press-in, but still releases cleanly', () => {
    const renderer = render({ disabled: true })
    const pressable = renderer.root.findByType('Pressable' as never)
    act(() => pressable.props.onPressIn({}))
    expect(springs.calls).toEqual([])
    act(() => pressable.props.onPressOut({}))
    expect(springs.calls).toEqual([{ to: 0, config: PRESS_OUT_SPRING }])
  })
})
