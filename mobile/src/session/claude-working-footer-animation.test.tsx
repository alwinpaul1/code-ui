import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { CLAUDE_WORKING_VERBS } from './claude-working-footer-spec'
import {
  WORKING_MARK,
  retargetWorkingMark,
  workingMarkFrameAt,
  workingMarkShapes,
  workingMarkStillFrame,
  type WorkingMarkFrame,
  type WorkingMarkKind
} from './claude-working-mark'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'

/**
 * The animation of the Claude app's working footer, pinned to what the app does: the working mark
 * at 30 frames a second, growing, then opening and looping its kind (com.anthropic.claude
 * 1.261013.20: `zq20`, `tr20`; claude-working-mark.ts), and the verb clock (`l8` in 1.261009.20,
 * assumed unchanged): a verb change after 3 s, 4 s, then every 6 s. Reduced motion holds the
 * kind's resting frame and the first verb.
 */

const mocks = vi.hoisted(() => ({ reduced: false as boolean | null }))

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G' }))

describe('the working footer animation', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.reduced = false
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function draw(working: boolean, runningCount = 0, markKind: WorkingMarkKind = 'think'): ReactTestInstance {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference="light">
          {createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount, openSheet: () => {} } },
            createElement(MobileNativeChatStatusLine, { working, markKind })
          )}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  /** The shapes the mark draws now, in the frame's own thousandths of the box. */
  const drawn = (root: ReactTestInstance) => {
    const layers = root.findAll((n) => n.props.testID === 'claude-working-mark-frame' && (n.type as unknown) === 'G')
    expect(layers).toHaveLength(1)
    return layers[0]!
      .findAll((n) => (n.type as unknown) === 'Circle' || (n.type as unknown) === 'Ellipse')
      .map((n) => ({ type: n.type as unknown as string, cx: n.props.cx, cy: n.props.cy, r: n.props.r ?? n.props.rx }))
  }
  const shapesOf = (frame: WorkingMarkFrame) =>
    workingMarkShapes(frame).map((shape) =>
      shape.kind === 'ellipse'
        ? { type: 'Ellipse', cx: shape.cx, cy: shape.cy, r: shape.rx }
        : { type: 'Circle', cx: shape.cx, cy: shape.cy, r: shape.r }
    )
  // Fake timers run the 33.3 ms interval every 33 ms; the mark draws the frame due at each tick.
  const TICK = Math.floor(WORKING_MARK.frameMs)
  const verbOf = (root: ReactTestInstance): string => {
    const text = root
      .findAllByType('Text' as never)
      .map((n) => n.props.children)
      .find((child) => typeof child === 'string' && child.endsWith('...'))
    return (text as string).replace('...', '')
  }

  it('grows for 10 frames at 30 a second, then opens and loops Think, as the app does', () => {
    const start = Date.now()
    const root = draw(true)
    const { player } = retargetWorkingMark(null, 'think', start)
    expect(drawn(root)).toEqual(shapesOf(workingMarkFrameAt(player, start)))
    for (const ticks of [1, 5, 11, 30, 60, 200]) {
      act(() => { vi.advanceTimersByTime(ticks * TICK) })
      const due = workingMarkFrameAt(player, Date.now())
      expect(drawn(root)).toEqual(shapesOf(due))
    }
  })

  it('draws the mark in a 20 dp box', () => {
    const root = draw(true)
    const box = root.find((n) => n.props.testID === 'claude-working-mark' && (n.type as unknown) === 'View')
    expect(box.props.style).toMatchObject({ width: 20, height: 20 })
    const svg = root.find((n) => (n.type as unknown) === 'Svg')
    expect(svg.props).toMatchObject({ width: 20, height: 20, viewBox: '0 0 1000 1000' })
  })

  it('stops the frame clock when the turn ends, and leaves no timer behind', () => {
    draw(true, 2)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    draw(false, 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('under reduced motion holds each kind\'s resting frame and starts no timer', () => {
    mocks.reduced = true
    for (const kind of ['think', 'code', 'waitingForUser'] as const) {
      const root = draw(true, 0, kind)
      expect(drawn(root)).toEqual(shapesOf(workingMarkStillFrame(kind)))
      expect(vi.getTimerCount()).toBe(0)
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(drawn(root)).toEqual(shapesOf(workingMarkStillFrame(kind)))
      expect(verbOf(root)).toBe('Clauding')
    }
  })

  it('holds the resting frame and the first verb while the OS has not said whether motion is reduced', () => {
    mocks.reduced = null
    const root = draw(true)
    expect(drawn(root)).toEqual(shapesOf(workingMarkStillFrame('think')))
    expect(verbOf(root)).toBe('Clauding')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('changes the verb after 3 s, then 4 s, then every 6 s', () => {
    const picks = [5, 10, 15, 2]
    let call = 0
    vi.spyOn(Math, 'random').mockImplementation(() => (picks[call++ % picks.length]! + 0.5) / 20)
    const root = draw(true)
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[5])
    act(() => { vi.advanceTimersByTime(2999) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[5])
    act(() => { vi.advanceTimersByTime(1) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[10])
    act(() => { vi.advanceTimersByTime(3999) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[10])
    act(() => { vi.advanceTimersByTime(1) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[15])
    act(() => { vi.advanceTimersByTime(5999) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[15])
    act(() => { vi.advanceTimersByTime(1) })
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[2])
  })

  it('animates beside the count too, with one task and with many', () => {
    for (const tasks of [1, 12]) {
      const start = Date.now()
      const root = draw(true, tasks)
      const { player } = retargetWorkingMark(null, 'think', start)
      act(() => { vi.advanceTimersByTime(40 * TICK) })
      expect(drawn(root)).toEqual(shapesOf(workingMarkFrameAt(player, Date.now())))
      expect(drawn(root)).not.toEqual(shapesOf(workingMarkFrameAt(player, start)))
    }
  })

  it('draws no mark and runs no timer for tasks alone', () => {
    const root = draw(false, 3)
    expect(root.findAll((n) => n.props.testID === 'claude-working-mark')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
