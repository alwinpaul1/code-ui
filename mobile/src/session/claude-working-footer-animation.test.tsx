import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { CLAUDE_SPINNER, CLAUDE_WORKING_VERBS } from './claude-working-footer-spec'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'

/**
 * The animation of the Claude app's working footer, pinned to what the app does
 * (com.anthropic.claude 1.261009.20: `zn` case 13 for the frame clock, `l8` for the verb clock;
 * numbers in claude-working-footer-spec.ts): 84 frames at 60 ms, a verb change after 3 s, 4 s,
 * then every 6 s. Reduced motion holds the star at rest and the first verb.
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

  function draw(working: boolean, runningCount = 0): ReactTestInstance {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference="light">
          {createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount, openSheet: () => {} } },
            createElement(MobileNativeChatStatusLine, { working })
          )}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  const frameOf = (root: ReactTestInstance): number => {
    const strip = root.find((n) => n.props.testID === 'claude-spinner-sprite-strip')
    const translateY = (strip.props.style.transform as Array<{ translateY: number }>)[0]!.translateY
    return -translateY / CLAUDE_SPINNER.size
  }
  const verbOf = (root: ReactTestInstance): string => {
    const text = root
      .findAllByType('Text' as never)
      .map((n) => n.props.children)
      .find((child) => typeof child === 'string' && child.endsWith('...'))
    return (text as string).replace('...', '')
  }

  it('plays one frame every 60 ms from the first', () => {
    const root = draw(true)
    expect(frameOf(root)).toBe(0)
    act(() => vi.advanceTimersByTime(59))
    expect(frameOf(root)).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(frameOf(root)).toBe(1)
    act(() => vi.advanceTimersByTime(60 * 9))
    expect(frameOf(root)).toBe(10)
  })

  it('wraps from frame 83 to frame 0 and runs the 84 frames in 5040 ms', () => {
    const root = draw(true)
    act(() => vi.advanceTimersByTime(60 * 83))
    expect(frameOf(root)).toBe(83)
    act(() => vi.advanceTimersByTime(60))
    expect(frameOf(root)).toBe(0)
    act(() => vi.advanceTimersByTime(5040))
    expect(frameOf(root)).toBe(0)
  })

  it('draws the sprite as a 16 dp window on a strip 84 frames tall', () => {
    const root = draw(true)
    const window = root.find((n) => n.props.testID === 'claude-spinner-sprite')
    expect(window.props.style).toMatchObject({ width: 16, height: 16, overflow: 'hidden' })
    const strip = root.find((n) => n.props.testID === 'claude-spinner-sprite-strip')
    expect(strip.props.style).toMatchObject({ width: 16, height: 16 * 84 })
  })

  it('stops the frame clock when the turn ends, and leaves no timer behind', () => {
    draw(true, 2)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    draw(false, 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('under reduced motion holds the star at rest and starts no timer', () => {
    mocks.reduced = true
    const root = draw(true)
    expect(frameOf(root)).toBe(4)
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(10_000))
    expect(frameOf(root)).toBe(4)
    expect(verbOf(root)).toBe('Clauding')
  })

  it('holds the star at rest and the first verb while the OS has not said whether motion is reduced', () => {
    mocks.reduced = null
    const root = draw(true)
    expect(frameOf(root)).toBe(4)
    expect(verbOf(root)).toBe('Clauding')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('changes the verb after 3 s, then 4 s, then every 6 s', () => {
    const picks = [5, 10, 15, 2]
    let call = 0
    vi.spyOn(Math, 'random').mockImplementation(() => (picks[call++ % picks.length]! + 0.5) / 20)
    const root = draw(true)
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[5])
    act(() => vi.advanceTimersByTime(2999))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[5])
    act(() => vi.advanceTimersByTime(1))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[10])
    act(() => vi.advanceTimersByTime(3999))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[10])
    act(() => vi.advanceTimersByTime(1))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[15])
    act(() => vi.advanceTimersByTime(5999))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[15])
    act(() => vi.advanceTimersByTime(1))
    expect(verbOf(root)).toBe(CLAUDE_WORKING_VERBS[2])
  })

  it('animates beside the count too, with one task and with many', () => {
    for (const tasks of [1, 12]) {
      const root = draw(true, tasks)
      act(() => vi.advanceTimersByTime(120))
      expect(frameOf(root)).toBe(2)
    }
  })

  it('draws no spinner and runs no timer for tasks alone', () => {
    const root = draw(false, 3)
    expect(root.findAll((n) => n.props.testID === 'claude-spinner-sprite')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
