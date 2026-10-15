import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROLLING_FADE_MS, ROLLING_SPRING, rollingRuns, rollingSlots, rollsUpward } from './claude-rolling-text'

/**
 * The working footer's figures roll as the Claude app's do (`z530.a`, com.anthropic.claude
 * 1.261013.20; claude-rolling-text.ts). Before this, "9s" to "10s" redrew the whole line: the
 * words after the figure jumped sideways each second, where the app's recording of 2026-10-15
 * holds them still and rolls only the digit that changed.
 */

const mocks = vi.hoisted(() => ({
  reduced: false as boolean | null,
  started: [] as string[]
}))

vi.mock('react-native', () => {
  class Value {
    value: number
    constructor(value: number) {
      this.value = value
    }
    setValue(value: number) {
      this.value = value
    }
    interpolate() {
      return this
    }
  }
  const motion = (kind: string) => () => ({ start: () => mocks.started.push(kind), stop: () => {} })
  return {
    Animated: {
      Text: 'AnimatedText',
      Value,
      spring: (_value: unknown, config: unknown) => ({ ...(motion('spring')() as object), config }),
      timing: motion('timing'),
      parallel: (parts: Array<{ start: () => void }>) => ({
        start: () => parts.forEach((part) => part.start()),
        stop: () => {}
      })
    },
    Easing: { linear: (t: number) => t },
    Text: 'Text',
    View: 'View'
  }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))

import { ClaudeRollingText } from './ClaudeRollingText'

describe('the figures in a rolling line', () => {
  it('reads "15s · 1,234 tokens" as two numbers, the thousands comma inside the second', () => {
    expect(rollingRuns('15s · 1,234 tokens')).toEqual([
      { kind: 'number', text: '15' },
      { kind: 'plain', text: 's · ' },
      { kind: 'number', text: '1,234' },
      { kind: 'plain', text: ' tokens' }
    ])
  })

  it('keeps a trailing comma or point out of the number, and reads "2m 5s" as two numbers', () => {
    expect(rollingRuns('12, ')).toEqual([
      { kind: 'number', text: '12' },
      { kind: 'plain', text: ', ' }
    ])
    expect(rollingRuns('2m 5s')).toEqual([
      { kind: 'number', text: '2' },
      { kind: 'plain', text: 'm ' },
      { kind: 'number', text: '5' },
      { kind: 'plain', text: 's' }
    ])
  })

  it('has no runs for an empty line, and one for a single character', () => {
    expect(rollingRuns('')).toEqual([])
    expect(rollingRuns('7')).toEqual([{ kind: 'number', text: '7' }])
    expect(rollingSlots('')).toEqual([])
    expect(rollingSlots('s')).toEqual([{ key: 'c0', ch: 's', digit: false }])
  })

  it('rolls upward when the figure grew and downward when it shrank, judged from the end', () => {
    expect(rollsUpward('9s', '10s')).toBe(true)
    expect(rollsUpward('15s · 40 tokens', '15s · 12 tokens')).toBe(false)
    // The last number changed first, so it decides even when an earlier one went the other way.
    expect(rollsUpward('59s · 3 tokens', '1m 0s · 4 tokens')).toBe(true)
    // Nothing changed: the last direction stands.
    expect(rollsUpward('5s', '5s', false)).toBe(false)
  })

  it('keys each character from the end, so "9s" to "10s" keeps the units digit and the s in their slots', () => {
    const before = rollingSlots('9s')
    const after = rollingSlots('10s')
    expect(before.map((slot) => slot.key)).toEqual(['c1', 'c0'])
    expect(after.map((slot) => slot.key)).toEqual(['c2', 'c1', 'c0'])
    expect(after.find((slot) => slot.key === 'c0')!.ch).toBe('s')
    expect(after.find((slot) => slot.key === 'c2')).toMatchObject({ ch: '1', digit: true })
  })

  it('springs at the app\'s stiffness 380 and damping ratio 0.9, and fades over 130 ms', () => {
    expect(ROLLING_SPRING.stiffness).toBe(380)
    expect(ROLLING_SPRING.damping / (2 * Math.sqrt(ROLLING_SPRING.stiffness * ROLLING_SPRING.mass))).toBeCloseTo(0.9, 9)
    expect(ROLLING_FADE_MS).toBe(130)
  })
})

describe('the rolling line on screen', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    mocks.reduced = false
    mocks.started = []
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const style = { fontSize: 15, lineHeight: 21, color: '#7B7974' }

  function draw(text: string): ReactTestInstance {
    act(() => {
      if (renderer) {
        renderer.update(<ClaudeRollingText text={text} style={style} testID="stats" />)
      } else {
        renderer = create(<ClaudeRollingText text={text} style={style} testID="stats" />)
      }
    })
    return renderer!.root
  }

  /** The measuring Text reports the widest digit as 9.5 dp. */
  function measure(root: ReactTestInstance) {
    const ruler = root.find((n) => (n.type as unknown) === 'Text' && n.props.importantForAccessibility === 'no')
    act(() => ruler.props.onTextLayout({ nativeEvent: { lines: [{ width: 8.1 }, { width: 9.5 }, { width: 9 }] } }))
  }

  const digitSlots = (root: ReactTestInstance) =>
    root.findAll((n) => (n.type as unknown) === 'View' && n.props.style?.alignItems === 'center')

  it('says the whole line to a screen reader, and draws every digit in a slot as wide as the widest digit', () => {
    const root = draw('15s · 1,234 tokens')
    measure(root)
    expect(root.find((n) => n.props.testID === 'stats' && (n.type as unknown) === 'View').props.accessibilityLabel).toBe('15s · 1,234 tokens')
    const slots = digitSlots(root)
    expect(slots).toHaveLength(6)
    for (const slot of slots) {
      expect(slot.props.style.width).toBe(9.5)
    }
  })

  it('rolls only the digit that changed, on the app\'s spring and fade', () => {
    const root = draw('9s')
    draw('10s')
    expect(mocks.started.sort()).toEqual(['spring', 'timing'])
    const moving = root.findAll((n) => (n.type as unknown) === 'AnimatedText')
    // The units digit went 9 -> 0: the old one leaves, the new one arrives. The new tens digit
    // and the s are drawn still.
    expect(moving.map((n) => n.props.children)).toEqual(['9', '0'])
  })

  // Second review of bbe93c5a9: the leaving and arriving digits slide a full line height, and an
  // unclipped slot paints them over the message above and the composer below for ~130 ms.
  it('clips a rolling digit to its own line, so it never paints over the message above', () => {
    const root = draw('9s')
    draw('10s')
    const moving = root.findAll((n) => (n.type as unknown) === 'AnimatedText')
    const slot = moving[0]!.parent!
    expect(slot.props.style).toMatchObject({ overflow: 'hidden', height: 21 })
  })

  it('under reduced motion draws the new digit with no roll', () => {
    mocks.reduced = true
    const root = draw('9s')
    draw('10s')
    expect(mocks.started).toEqual([])
    expect(root.findAll((n) => (n.type as unknown) === 'AnimatedText')).toHaveLength(0)
  })
})
