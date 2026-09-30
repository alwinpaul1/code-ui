import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// The real drawer keeps its content mounted only while it is open (and for
// its close animation), so its children are drawn only when visible.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

const at = (hhmm: string): number => new Date(`2026-09-30T${hhmm}:00Z`).getTime()
const epochSeconds = (hhmm: string): number => Math.floor(at(hhmm) / 1000)

function texts(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => [node.props.children].flat().join(''))
}

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter((entry) => Boolean(entry) && typeof entry === 'object'))
}

/** The Session row's figure, "50% · resets in …". */
const sessionFigure = (root: ReactTestInstance): string | undefined =>
  texts(root).find((text) => text.startsWith('50%'))

function sheet(
  scheme: 'light' | 'dark',
  visible: boolean,
  context: TerminalHudContextWindow | null
) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileContextWindowSheet visible={visible} context={context} onClose={() => {}} />
    </ThemeProvider>
  )
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the context window sheet in a %s session', (scheme, palette) => {
  // The composer mounts the sheet with the chat and only flips `visible` when
  // the ring is tapped, so a clock read at mount was the chat's opening time:
  // two hours into a chat, a window resetting in one hour read "resets in 3h
  // 0m" (review, 2026-09-30).
  const session = (resetsAt: number): TerminalHudContextWindow => ({
    usedPercent: 40,
    limits: [{ name: 'Session', usedPercent: 50, windowMinutes: 300, resetsAt }]
  })

  it('counts a limit reset from when the sheet is opened, not from when the chat was', () => {
    vi.setSystemTime(at('10:00'))
    act(() => {
      renderer = create(sheet(scheme, false, session(epochSeconds('13:00'))))
    })
    vi.setSystemTime(at('12:00'))
    act(() => renderer!.update(sheet(scheme, true, session(epochSeconds('13:00')))))
    expect(sessionFigure(renderer!.root)).toBe('50% · resets in 1h 0m')
    // Still drawn in the theme's own secondary text colour.
    const figure = renderer!.root.find(
      (node) => String(node.type) === 'Text' && [node.props.children].flat().join('').startsWith('50%')
    )
    expect(flat(figure.props.style).color).toBe(palette.textSecondary)
  })

  it('says "resetting now" for a reset that passed while the chat sat open', () => {
    vi.setSystemTime(at('10:00'))
    act(() => {
      renderer = create(sheet(scheme, false, session(epochSeconds('13:00'))))
    })
    vi.setSystemTime(at('14:00'))
    act(() => renderer!.update(sheet(scheme, true, session(epochSeconds('13:00')))))
    expect(sessionFigure(renderer!.root)).toBe('50% · resetting now')
  })

  it('reads the clock again each time the sheet is reopened', () => {
    vi.setSystemTime(at('10:00'))
    act(() => {
      renderer = create(sheet(scheme, true, session(epochSeconds('13:00'))))
    })
    expect(sessionFigure(renderer!.root)).toBe('50% · resets in 3h 0m')
    act(() => renderer!.update(sheet(scheme, false, session(epochSeconds('13:00')))))
    vi.setSystemTime(at('12:30'))
    act(() => renderer!.update(sheet(scheme, true, session(epochSeconds('13:00')))))
    expect(sessionFigure(renderer!.root)).toBe('50% · resets in 30m')
  })
})
