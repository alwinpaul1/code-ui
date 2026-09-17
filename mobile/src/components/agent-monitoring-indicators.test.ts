import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSpinner } from './AgentSpinner'
import { AgentStateDot } from './AgentStateDot'
import { resetReducedMotionForTests } from '../ui/use-reduced-motion'

const DESKTOP_WORKING_COLOR = '#eab308'

type MonitoringTestRenderer = {
  readonly root: {
    findByType(type: string): { props: Record<string, unknown> }
  }
  unmount(): void
}

const { animationLoop, animationTiming, setValue } = vi.hoisted(() => ({
  animationLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  animationTiming: vi.fn(() => ({})),
  setValue: vi.fn()
}))

const motion = vi.hoisted(() => ({ reduced: false }))

vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  CircleCheck: 'CircleCheck',
  MessageCircleQuestionMark: 'MessageCircleQuestionMark'
}))
vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(motion.reduced)
  },
  Animated: {
    Value: function Value() {
      return { interpolate: vi.fn(() => 'rotation'), setValue }
    },
    View: 'AnimatedView',
    loop: animationLoop,
    timing: animationTiming
  },
  Easing: { linear: 'linear' },
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View'
}))

describe('mobile monitoring indicators', () => {
  let renderer: MonitoringTestRenderer | null = null

  beforeEach(() => {
    animationLoop.mockClear()
    animationTiming.mockClear()
    setValue.mockClear()
    motion.reduced = false
    resetReducedMotionForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders a static Activity heartbeat for a monitoring agent', async () => {
    await act(async () => {
      renderer = create(createElement(AgentStateDot, { state: 'monitoring' }))
    })

    expect(renderer?.root.findByType('Activity').props).toMatchObject({
      color: DESKTOP_WORKING_COLOR,
      size: 10
    })
    expect(animationTiming).not.toHaveBeenCalled()
    expect(animationLoop).not.toHaveBeenCalled()
  })

  it('renders a static Activity heartbeat for an all-monitoring workspace', async () => {
    await act(async () => {
      renderer = create(
        createElement(AgentSpinner, { status: 'working', workingMode: 'monitoring' })
      )
    })

    expect(renderer?.root.findByType('Activity').props).toMatchObject({
      color: DESKTOP_WORKING_COLOR,
      size: 12
    })
    expect(animationTiming).not.toHaveBeenCalled()
    expect(animationLoop).not.toHaveBeenCalled()
  })

  it('keeps the spinner fallback when workingMode is absent', async () => {
    await act(async () => {
      renderer = create(createElement(AgentSpinner, { status: 'working' }))
    })

    expect(animationTiming).toHaveBeenCalledOnce()
    expect(animationLoop).toHaveBeenCalledOnce()
  })

  // "Remove animations" on, and the worktree list's spinners kept turning
  // (0.6.6 audit: reduced motion was honoured in four files, none of them
  // here). The glyph stays, so a working row still reads as working; it
  // just does not move.
  it('holds the worktree spinner still when the OS reduces motion', async () => {
    motion.reduced = true
    await act(async () => {
      renderer = create(createElement(AgentSpinner, { status: 'working' }))
    })

    expect(renderer?.root.findByType('AnimatedView')).toBeDefined()
    expect(animationLoop).not.toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledWith(0)
  })

  it('holds the agent spinner still when the OS reduces motion', async () => {
    motion.reduced = true
    await act(async () => {
      renderer = create(createElement(AgentStateDot, { state: 'working' }))
    })

    expect(renderer?.root.findByType('AnimatedView')).toBeDefined()
    expect(animationLoop).not.toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledWith(0)
  })
})
