import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import type { BackgroundTask } from './mobile-background-tasks'
import { agentPulseAlpha } from './claude-motion-spec'

// The Claude app's workflow card (1.261009.20, cu2.java:2609, 1071): a running
// workflow's status dot is the blue `pl7.m` and pulses with the first agent
// pulse, alpha 1.0 down to 0.55 and back on a 1200 ms cubic-bezier(0.4, 0, 0.2, 1)
// tween; a settled one stands still in the muted or the error tone. The app's
// grid of agent cells lives under each phase and needs to know which agent is
// in which, which the phone is never told while the workflow runs, so only the
// dot moves here (the card's existing "no squares" rule stands).

const seen = vi.hoisted(() => ({
  timings: [] as { to: number; config: { duration?: number; easing?: unknown } | undefined }[],
  repeats: [] as { times: number; reverse: boolean | undefined }[],
  cancelled: 0,
  /** Where the pulse clock stands when a style is read. */
  clockAt: 0,
  reduced: false as boolean | null
}))

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => seen.reduced }))
// The values land at once and a style is read where the clock starts; every call is recorded.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  const AnimatedView = (props: Record<string, unknown>) =>
    React.createElement('AnimatedView', props, props.children as never)
  return {
    default: { View: AnimatedView },
    Easing: { linear: 'linear' },
    useSharedValue: () => React.useRef({ value: seen.clockAt }).current,
    useAnimatedStyle: (factory: () => Record<string, unknown>) => ({
      ...factory(),
      animatedStyle: true
    }),
    withTiming: (to: number, config?: { duration?: number; easing?: unknown }) => {
      seen.timings.push({ to, config })
      return to
    },
    withRepeat: (value: number, times: number, reverse?: boolean) => {
      seen.repeats.push({ times, reverse })
      return value
    },
    cancelAnimation: () => {
      seen.cancelled += 1
    }
  }
})

import { MobileWorkflowCard } from './MobileWorkflowCard'

function workflow(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'w1',
    kind: 'workflow',
    title: 'Review the diff',
    status: 'running',
    startedAt: 0,
    elapsedMs: 5_000,
    workflow: { description: null, phases: null, lanes: { count: 3, atLeast: false }, usage: null },
    ...overrides
  }
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

function card(task: BackgroundTask, scheme: 'light' | 'dark') {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileWorkflowCard task={task} />
    </ThemeProvider>
  )
}

function render(task: BackgroundTask, scheme: 'light' | 'dark'): ReactTestInstance {
  act(() => {
    renderer = create(card(task, scheme))
  })
  return renderer!.root
}

const dot = (root: ReactTestInstance): ReactTestInstance =>
  root.find(
    (node) => node.props.testID === 'workflow-status-dot' && String(node.type) === 'AnimatedView'
  )
const opacityOf = (node: ReactTestInstance): unknown => flat(node.props.style).opacity

beforeEach(() => {
  seen.timings.length = 0
  seen.repeats.length = 0
  seen.cancelled = 0
  seen.clockAt = 0
  seen.reduced = false
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])(
  'the status dot of a workflow card in a %s session',
  (scheme, palette) => {
    it('is the running blue and pulses while the workflow runs', () => {
      const root = render(workflow(), scheme)
      expect(flat(dot(root).props.style)).toMatchObject({
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: palette.info
      })
      // The style is the first pulse's: full alpha where the clock starts.
      expect(opacityOf(dot(root))).toBe(agentPulseAlpha(0, 0))
    })

    it.each([
      [0, 1],
      [1200, 0.55],
      [2400, 1]
    ])('reads alpha %s ms into the cycle as %s', (at, alpha) => {
      seen.clockAt = at
      expect(opacityOf(dot(render(workflow(), scheme)))).toBeCloseTo(alpha, 10)
    })

    it('runs one linear clock over a whole 2400 ms cycle, forever, for the pulse to read', () => {
      render(workflow(), scheme)
      expect(seen.timings).toEqual([{ to: 2400, config: { duration: 2400, easing: 'linear' } }])
      expect(seen.repeats).toEqual([{ times: -1, reverse: false }])
    })

    it('stands still, in the muted tone, once the workflow has completed', () => {
      const root = render(workflow({ status: 'completed', elapsedMs: null }), scheme)
      expect(flat(dot(root).props.style).backgroundColor).toBe(palette.textMuted)
      expect(opacityOf(dot(root))).toBe(1)
      expect(seen.timings).toEqual([])
    })

    it('stands still, in the danger tone, once it has failed', () => {
      const root = render(workflow({ status: 'failed', elapsedMs: null }), scheme)
      expect(flat(dot(root).props.style).backgroundColor).toBe(palette.danger)
      expect(opacityOf(dot(root))).toBe(1)
      expect(seen.timings).toEqual([])
    })
  }
)

describe('the pulse', () => {
  it.each([true, null])(
    'holds still at full alpha with no loop while reduced motion is %s',
    (reduced) => {
      seen.reduced = reduced
      const root = render(workflow(), 'dark')
      expect(opacityOf(dot(root))).toBe(1)
      expect(seen.timings).toEqual([])
      expect(seen.repeats).toEqual([])
    }
  )

  // A view that had an animated style and then lost it keeps the last opacity the UI thread wrote
  // (a dot that stopped mid-pulse would stay dim), so the style is never swapped for nothing.
  it.each([
    ['running', { status: 'running' as const }],
    ['completed', { status: 'completed' as const, elapsedMs: null }],
    ['failed', { status: 'failed' as const, elapsedMs: null }]
  ])('keeps the one animated style on the dot of a %s workflow', (_label, overrides) => {
    expect(flat(dot(render(workflow(overrides), 'light')).props.style).animatedStyle).toBe(true)
  })

  it('keeps the animated style on the dot when reduced motion is on', () => {
    seen.reduced = true
    expect(flat(dot(render(workflow(), 'light')).props.style).animatedStyle).toBe(true)
  })

  it('stops when the workflow ends: the loop is cancelled and a dot caught mid-pulse is drawn at full alpha again', () => {
    seen.clockAt = 1200
    const root = render(workflow(), 'light')
    expect(opacityOf(dot(root))).toBeCloseTo(0.55, 10)
    const before = seen.cancelled
    act(() => {
      renderer!.update(card(workflow({ status: 'completed', elapsedMs: null }), 'light'))
    })
    expect(seen.cancelled).toBeGreaterThan(before)
    expect(opacityOf(dot(renderer!.root))).toBe(1)
  })

  it('is cancelled when the card goes away mid-pulse', () => {
    render(workflow(), 'light')
    const before = seen.cancelled
    act(() => renderer?.unmount())
    renderer = null
    expect(seen.cancelled).toBeGreaterThan(before)
  })

  it('draws nothing, and keeps its hooks in order, for a task with no workflow detail', () => {
    const root = render(workflow({ workflow: undefined }), 'light')
    expect(root.findAll((node) => node.props.testID === 'workflow-status-dot')).toEqual([])
    // The detail arriving afterwards must not trip a changed hook count.
    act(() => {
      renderer!.update(card(workflow(), 'light'))
    })
    expect(dot(renderer!.root)).toBeDefined()
  })
})
