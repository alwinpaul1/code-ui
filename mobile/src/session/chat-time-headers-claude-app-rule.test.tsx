import { createElement, type ComponentType, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light'
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { chatTimeDividerLabels, formatChatDividerTime } from './mobile-native-chat-time-dividers'
import { MobileNativeChatTimeDivider } from './MobileNativeChatTimeDivider'

// The Claude app's time header (1.261013.20): above a message that is the first,
// that falls on a new calendar day, or that comes more than one hour after the
// one before (`jcz.a`); drawn as a plain centred caption (`ay8`); "3:45 pm"
// today, the weekday within the last seven calendar days, else the date with a
// short month (`ad00.b`: DateUtils SHOW_TIME | SHOW_WEEKDAY | ABBREV_MONTH).
// Code UI drew a wavy rule after a 20-minute pause only, never above the first
// message and never at a new day.

const Themed = ThemeProvider as unknown as ComponentType<{ initialPreference: 'light' | 'dark'; children?: ReactNode }>

const msg = (id: string, timestamp: number | null): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: id }],
  timestamp,
  source: 'transcript'
})
// 2026-09-13 (Sunday) 15:00 local.
const NOW = new Date(2026, 8, 13, 15, 0).getTime()
const MIN = 60_000

describe('when a time header shows, by the Claude app rule', () => {
  it('puts one above the first message', () => {
    const t0 = new Date(2026, 8, 13, 9, 0).getTime()
    expect([...chatTimeDividerLabels([msg('a', t0), msg('b', t0 + MIN)], NOW).keys()]).toEqual(['a'])
  })

  it('puts one above a message more than an hour after the one before, and none after a shorter pause', () => {
    const t0 = new Date(2026, 8, 13, 9, 0).getTime()
    const labels = chatTimeDividerLabels(
      [msg('a', t0), msg('b', t0 + 30 * MIN), msg('c', t0 + 90 * MIN), msg('d', t0 + 151 * MIN)],
      NOW
    )
    expect([...labels.keys()]).toEqual(['a', 'd'])
  })

  it('needs more than an hour: exactly sixty minutes is no pause', () => {
    const t0 = new Date(2026, 8, 13, 9, 0).getTime()
    expect([...chatTimeDividerLabels([msg('a', t0), msg('b', t0 + 60 * MIN), msg('c', t0 + 121 * MIN)], NOW).keys()]).toEqual(['a', 'c'])
  })

  it('puts one above the first message of a new calendar day, however short the pause', () => {
    const late = new Date(2026, 8, 12, 23, 55).getTime()
    expect([...chatTimeDividerLabels([msg('a', late), msg('b', late + 10 * MIN)], NOW).keys()]).toEqual(['a', 'b'])
  })

  it('has none for no messages, and skips a message with no time', () => {
    expect(chatTimeDividerLabels([], NOW).size).toBe(0)
    const t0 = new Date(2026, 8, 13, 9, 0).getTime()
    expect([...chatTimeDividerLabels([msg('x', null), msg('a', t0), msg('b', null), msg('c', t0 + 5 * MIN)], NOW).keys()]).toEqual(['a'])
  })

  it('names the weekday for the last seven calendar days, and the date from the eighth', () => {
    // Thursday 13 August 2026, 09:00: Friday the 7th is six days before, a
    // weekday; Thursday the 6th is seven days before, the date.
    const thursday = new Date(2026, 7, 13, 9, 0).getTime()
    expect(formatChatDividerTime(new Date(2026, 7, 7, 8, 0).getTime(), thursday)).toBe('Friday 8:00 am')
    expect(formatChatDividerTime(new Date(2026, 7, 6, 23, 0).getTime(), thursday)).toBe('6 Aug 11:00 pm')
  })
})

describe('the time header on screen', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is a plain centred caption in the muted colour, with no wavy rule, in %s', (scheme, colors) => {
    act(() => {
      renderer = create(
        createElement(Themed, { initialPreference: scheme }, createElement(MobileNativeChatTimeDivider, { label: 'Friday 8:29 pm' }))
      )
    })
    const root = renderer!.root
    expect(root.findAllByType('Svg' as never)).toHaveLength(0)
    const text = root.findAllByType('Text' as never).find((node) => node.children.join('') === 'Friday 8:29 pm')!
    const style = Object.assign({}, ...([] as unknown[]).concat(text.props.style).flat(Infinity).filter(Boolean)) as {
      color?: string
      textAlign?: string
    }
    expect(style.color).toBe(colors.textMuted)
    const box = root.findByProps({ testID: 'chat-time-divider' })
    const boxStyle = Object.assign({}, ...([] as unknown[]).concat(box.props.style).flat(Infinity).filter(Boolean)) as {
      alignItems?: string
    }
    expect(boxStyle.alignItems === 'center' || style.textAlign === 'center').toBe(true)
  })
})
