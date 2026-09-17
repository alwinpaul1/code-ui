import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reduced: false,
  repeats: 0,
  cancels: 0
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(mocks.reduced)
  },
  View: 'View'
}))
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  Easing: { out: (fn: unknown) => fn, quad: (t: number) => t },
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: <T,>(factory: () => T) => factory(),
  withTiming: (to: number) => to,
  withRepeat: (value: number) => {
    mocks.repeats += 1
    return value
  },
  cancelAnimation: () => {
    mocks.cancels += 1
  }
}))

import { StatusPulse } from './StatusPulse'
import { resetReducedMotionForTests } from './use-reduced-motion'

let renderer: ReactTestRenderer | null = null

async function render(pulse: boolean) {
  await act(async () => {
    renderer = create(createElement(StatusPulse, { color: '#5FB57F', pulse }))
  })
  return renderer!
}

beforeEach(() => {
  mocks.reduced = false
  mocks.repeats = 0
  mocks.cancels = 0
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('StatusPulse', () => {
  it('runs the expanding ring for a working state', async () => {
    await render(true)
    expect(mocks.repeats).toBe(1)
  })

  it('does not run it for a merely alive state', async () => {
    await render(false)
    expect(mocks.repeats).toBe(0)
  })

  // The ring is decoration over a dot that already says "working". With
  // "Remove animations" on it kept expanding (0.6.6 audit); now the dot
  // stands alone and the ring never starts.
  it('holds still when the OS reduces motion, even for a working state', async () => {
    mocks.reduced = true
    await render(true)
    expect(mocks.repeats).toBe(0)
    // The dot itself is still drawn: the state is not lost with the motion.
    expect(renderer!.root.findAllByType('View' as never).length).toBeGreaterThan(0)
  })
})
