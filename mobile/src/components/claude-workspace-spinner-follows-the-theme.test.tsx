import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react-native', () => ({ Activity: 'Activity' }))
vi.mock('react-native', () => ({
  AccessibilityInfo: { addEventListener: () => ({ remove: () => {} }), isReduceMotionEnabled: () => Promise.resolve(true) },
  Animated: {
    Value: function Value() {
      return { interpolate: () => 'rotation', setValue: () => {} }
    },
    View: 'AnimatedView',
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({})
  },
  Easing: { linear: 'linear' },
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'View',
  useColorScheme: () => 'light'
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { AgentSpinner } from './AgentSpinner'

// The workspace list's status glyph had the desktop's Tailwind hues hardcoded (#eab308, #10b981,
// #ef4444, neutral-500 at 40%), the same in light and dark. A workspace whose agents are Claude
// sessions now draws them in the live theme's tokens, so each scheme draws its own. A workspace
// with a Codex agent keeps the desktop hues: Codex is left exactly as it was.
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(scheme: 'light' | 'dark', props: { status: 'working' | 'active' | 'permission' | 'done' | 'inactive'; themed?: boolean; workingMode?: 'monitoring' }) {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{createElement(AgentSpinner, props) as ReactNode}</ThemeProvider>)
  })
}

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter((entry) => Boolean(entry) && typeof entry === 'object'))
}
const glyph = (): ReactTestInstance => renderer!.root.findAll((node) => (String(node.type) === 'View' || String(node.type) === 'AnimatedView') && node.parent !== null && String(node.parent.type) === 'View')[0]!

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a Claude workspace’s status glyph in %s mode', (scheme, palette) => {
  it('draws working, done, permission and idle in the theme’s tokens', () => {
    mount(scheme, { status: 'working', themed: true })
    expect(flat(glyph().props.style).borderColor).toBe(palette.warning)
    mount(scheme, { status: 'done', themed: true })
    expect(flat(glyph().props.style).backgroundColor).toBe(palette.success)
    mount(scheme, { status: 'active', themed: true })
    expect(flat(glyph().props.style).backgroundColor).toBe(palette.success)
    mount(scheme, { status: 'permission', themed: true })
    expect(flat(glyph().props.style).backgroundColor).toBe(palette.danger)
    mount(scheme, { status: 'inactive', themed: true })
    expect(flat(glyph().props.style)).toMatchObject({ backgroundColor: palette.textMuted, opacity: 0.4 })
  })

  it('draws the monitoring heartbeat in the theme’s working token', () => {
    mount(scheme, { status: 'working', themed: true, workingMode: 'monitoring' })
    expect(renderer!.root.findByType('Activity' as never).props.color).toBe(palette.warning)
  })

  it('keeps the desktop hues for any other workspace', () => {
    mount(scheme, { status: 'working' })
    expect(flat(glyph().props.style).borderColor).toBe('#eab308')
    mount(scheme, { status: 'permission' })
    expect(flat(glyph().props.style).backgroundColor).toBe('#ef4444')
  })
})
