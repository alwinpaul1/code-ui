import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Add context sheet's Permission row with no mode read. It printed
 * `permissionMode ? permissionModeLabel(permissionMode) : 'Auto'`, so a null
 * mode read as Auto, a real mode and the riskier one. Null is what the HUD
 * now says whenever no footer was read (NO_SCREEN_HUD_OBSERVATION, review
 * 2026-09-30), so the row must say the mode is not known, and still open the
 * mode sheet so one can be picked. Drawn with the real Txt, theme and labels.
 */

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
vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  Image: 'Image',
  Paperclip: 'Paperclip',
  Zap: 'Zap',
  ChevronRight: 'ChevronRight'
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'
import {
  CODEX_AGENT_MODES,
  permissionModeLabel,
  type TerminalPermissionMode
} from './mobile-terminal-hud-parse'

const EVERY_MODE: TerminalPermissionMode[] = ['default', 'manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']
/** Every name a mode is shown by, Claude's and Codex's. */
const MODE_NAMES = new Set([...EVERY_MODE.map(permissionModeLabel), ...CODEX_AGENT_MODES.map((mode) => mode.label)])

function stylesOf(style: unknown, pressed = false): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap((entry) => stylesOf(entry, pressed))
  }
  if (typeof style === 'function') {
    return stylesOf(style({ pressed }), pressed)
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

describe('the Permission row of the Add context sheet with no mode read', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function renderRow(
    props: { permissionMode?: TerminalPermissionMode | null; onClose?: () => void; onOpenPermission?: () => void },
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestInstance {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatAttachSheet
            visible
            onClose={props.onClose ?? vi.fn()}
            onAttachImage={vi.fn()}
            onOpenPermission={props.onOpenPermission ?? vi.fn()}
            {...('permissionMode' in props ? { permissionMode: props.permissionMode } : {})}
          />
        </ThemeProvider>
      )
    })
    return renderer!.root.find(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Permission mode'
    )
  }

  function texts(row: ReactTestInstance): ReactTestInstance[] {
    return row.findAll((node) => String(node.type) === 'Text')
  }

  function caption(row: ReactTestInstance): string {
    const [title, value] = texts(row)
    expect(title?.props.children).toBe('Permission')
    return String(value?.props.children)
  }

  it.each([
    ['null', { permissionMode: null }],
    ['not passed at all', {}]
  ])('says the mode is not known, not Auto, when the mode is %s', (_case, props) => {
    const shown = caption(renderRow(props))
    expect(shown).not.toBe('Auto')
    expect(MODE_NAMES.has(shown)).toBe(false)
    expect(shown).toMatch(/not known/i)
  })

  it('keeps the row tappable with the mode unknown, so a mode can still be picked', () => {
    const onClose = vi.fn()
    const onOpenPermission = vi.fn()
    const row = renderRow({ permissionMode: null, onClose, onOpenPermission })
    expect(row.props.disabled).toBeFalsy()
    act(() => row.props.onPress())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenPermission).toHaveBeenCalledOnce()
  })

  it.each(EVERY_MODE)('still names the mode a footer read: %s', (mode) => {
    expect(caption(renderRow({ permissionMode: mode }))).toBe(permissionModeLabel(mode))
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the unknown row from the %s theme', (scheme, palette) => {
    const row = renderRow({ permissionMode: null }, scheme)
    expect(stylesOf(row.props.style).map((style) => style.backgroundColor)).toContain(palette.bgPanel)
    expect(stylesOf(row.props.style, true).map((style) => style.backgroundColor)).toContain(palette.bgRaised)
    const [title, value] = texts(row)
    expect(stylesOf(title!.props.style).map((style) => style.color)).toContain(palette.text)
    expect(stylesOf(value!.props.style).map((style) => style.color)).toContain(palette.textSecondary)
    const chevron = row.find((node) => String(node.type) === 'ChevronRight')
    expect(chevron.props.color).toBe(palette.textMuted)
  })

  it('does not paint the two schemes alike, so the pins above can tell them apart', () => {
    expect(lightColors.bgPanel).not.toBe(darkColors.bgPanel)
    expect(lightColors.textSecondary).not.toBe(darkColors.textSecondary)
  })
})
