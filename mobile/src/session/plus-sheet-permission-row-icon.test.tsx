import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The user, 2026-10-14: with the composer's mode chip gone, the + sheet's "Permission" row is
// where the mode lives, so its icon is the current mode's coloured one (the same glyph and tint
// the Select mode sheet draws, permission-mode-appearance.ts). It was one lightning bolt in the
// text colour for every mode. The Claude app's own row draws a plain glyph here (`ae2`, `ay20.b`:
// the list's muted icon colour); the colour is the user's request, not the app's.

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'
import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const GLYPHS = new Set(['Hand', 'Code', 'ScrollText', 'Zap'])

/** The glyph in the row's leading circle: the one icon that is not the trailing chevron. */
function rowIcon(
  scheme: 'light' | 'dark',
  props: { permissionMode?: TerminalPermissionMode | null; agentMode?: TerminalAgentMode | null }
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatAttachSheet visible onClose={() => {}} onOpenPermission={() => {}} {...props} />
      </ThemeProvider>
    )
  })
  const row = renderer!.root.find(
    (node) => String(node.type) === 'Pressable' && /^(Permission mode|Mode)$/.test(String(node.props.accessibilityLabel))
  )
  const icons = row.findAll((node) => GLYPHS.has(String(node.type)))
  expect(icons).toHaveLength(1)
  return icons[0]!
}

describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the + sheet Permission row icon, %s', (scheme, colors) => {
  it.each<[TerminalPermissionMode, string, string]>([
    ['manual', 'Hand', colors.modeManual],
    ['default', 'Hand', colors.modeManual],
    ['acceptEdits', 'Code', colors.modeAcceptEdits],
    ['plan', 'ScrollText', colors.modePlan],
    ['auto', 'Zap', colors.modeAuto],
    ['bypassPermissions', 'Zap', colors.modeAuto]
  ])('draws %s as a %s in the mode colour token', (mode, glyph, tint) => {
    const icon = rowIcon(scheme, { permissionMode: mode })
    expect(String(icon.type)).toBe(glyph)
    expect(icon.props.color).toBe(tint)
  })

  it('draws a mode nobody read as the plain bolt in the text colour, claiming no mode', () => {
    for (const permissionMode of [null, undefined]) {
      const icon = rowIcon(scheme, { permissionMode })
      expect(String(icon.type)).toBe('Zap')
      expect(icon.props.color).toBe(colors.text)
      act(() => renderer?.unmount())
    }
  })

  it('keeps a Codex tab’s Mode row plain: a Claude permission colour would name a mode Codex has not', () => {
    const icon = rowIcon(scheme, { agentMode: 'plan', permissionMode: 'auto' })
    expect(String(icon.type)).toBe('Zap')
    expect(icon.props.color).toBe(colors.text)
  })
})
