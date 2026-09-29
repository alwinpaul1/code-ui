import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Voice settings screen in both themes. Reported 2026-09-27: with the phone in LIGHT mode,
 * this screen drew dark. Cause: it (and the switch row, the model list and the setup sheet it
 * shares) painted from the LEGACY static palette (`mobile-theme.ts`), which is dark-only and
 * cannot follow the appearance setting. Now every colour comes from `useTheme()` /
 * `useThemedStyles()`, so this pins the canvas and its rows in both schemes — a hardcoded colour
 * would pass every other check and still ship the wrong mode.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight'
}))
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() })
}))
vi.mock('./transport/host-store', () => ({ loadHostCatalog: async () => [] }))
vi.mock('./transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: [], focused: true })
}))

import VoiceSettingsScreen from '../app/voice-settings'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  if (typeof style === 'function') {
    return [...stylesOf(style({ pressed: false })), ...stylesOf(style({ pressed: true }))]
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

describe('draws the Voice settings screen light in a light session', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its canvas, heading and rows from the %s theme', async (scheme, palette) => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(VoiceSettingsScreen)}
        </ThemeProvider>
      )
    })

    const root = renderer!.root
    const canvas = root.findAll((node) => String(node.type) === 'View')[0]
    expect(stylesOf(canvas?.props.style).map((s) => s.backgroundColor)).toContain(palette.bg)

    const heading = root.findAll(
      (node) => String(node.type) === 'Text' && node.props.children === 'Voice'
    )[0]
    expect(stylesOf(heading!.props.style).map((s) => s.color)).toContain(palette.text)

    const dictationModeLabel = root.findAll(
      (node) => String(node.type) === 'Text' && node.props.children === 'Dictation Mode'
    )[0]
    expect(stylesOf(dictationModeLabel!.props.style).map((s) => s.color)).toContain(palette.text)

    const enableLabel = root.findAll(
      (node) => String(node.type) === 'Text' && node.props.children === 'Enable Voice Dictation'
    )[0]
    expect(stylesOf(enableLabel!.props.style).map((s) => s.color)).toContain(palette.text)

    const toggle = root.findByType('Switch' as never)
    expect(toggle.props.trackColor).toEqual({ false: palette.bgRaised, true: palette.textSecondary })
    expect(toggle.props.thumbColor).toBe(palette.text)
  })

  it('does not paint the two schemes alike, so the pins above can tell them apart', () => {
    expect(lightColors.bg).not.toBe(darkColors.bg)
    expect(lightColors.text).not.toBe(darkColors.text)
  })
})
