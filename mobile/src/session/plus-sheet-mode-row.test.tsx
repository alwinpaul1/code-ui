import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The Add context sheet said "Permission: Manual" on a Codex session in Plan
// mode. Codex has no permission mode, so its footer parse fills
// permissionMode with 'default', which permissionModeLabel prints as
// "Manual"; the composer never passed agentMode to the + button, so the row
// that opens Codex's Plan/Default sheet was captioned with Claude's
// permission label (review, 2026-09-30). The row now says "Mode" and Codex's
// own mode on a Codex tab, and keeps its Permission caption on a Claude one.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Keyboard: {
      dismiss: () => {},
      isVisible: () => true,
      addListener: () => ({ remove: () => {} })
    },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})

vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: unknown }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children as React.ReactNode) : null
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { parseCodexHudObservation, parseTerminalHudObservation } from './mobile-terminal-hud-parse'

type ComposerProps = ComponentProps<typeof MobileNativeChatComposer>

// codex-cli 0.153.4's footer (live capture 2026-09-09, the Plan row
// mobile-terminal-hud-parse.test.ts pins), with and without the Plan hint.
const CODEX_PLAN_FOOTER = [
  '› Ask Codex to do anything',
  '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
]
const CODEX_DEFAULT_FOOTER = ['› Ask Codex to do anything', '  gpt-5.6-sol medium · ~/Project']

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function styleOf(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter((entry) => Boolean(entry) && typeof entry === 'object'))
}

/** Mounts the composer, opens the + sheet, and returns the row under the
 *  source cards (the one that opens the mode sheet). */
async function modeRow(scheme: 'light' | 'dark', props: Partial<ComposerProps>): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: '',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          onCaptureImage: () => {},
          onAttachImage: () => {},
          onAttachFile: () => {},
          ...props
        } as ComposerProps)}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => true }) }
    )
  })
  const plus = renderer!.root.find(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Add to chat'
  )
  await act(async () => (plus.props.onPress as () => void)())
  const drawer = renderer!.root.find((node) => node.type === 'BottomDrawer')
  const rows = drawer.findAll(
    (node) => node.type === 'Pressable' && node.findAll((child) => child.type === 'ChevronRight').length > 0
  )
  expect(rows).toHaveLength(1)
  return rows[0]!
}

function titleAndCaption(row: ReactTestInstance): [ReactTestInstance, ReactTestInstance] {
  const [title, caption] = row.findAll((node) => node.type === 'Text')
  return [title!, caption!]
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the + sheet mode row in a %s session', (scheme, palette) => {
  it('says "Mode: Plan" on a Codex tab in Plan mode, never "Permission: Manual"', async () => {
    const footer = parseTerminalHudObservation(CODEX_PLAN_FOOTER)!
    // The reason the caption read Manual: Codex's parse fills a permission mode.
    expect(footer).toMatchObject({ agentMode: 'plan', permissionMode: 'default' })
    expect(parseCodexHudObservation(CODEX_PLAN_FOOTER)).toMatchObject({ agentMode: 'plan' })
    const row = await modeRow(scheme, {
      agent: 'codex',
      permissionMode: footer.permissionMode,
      agentMode: footer.agentMode,
      onSelectAgentMode: () => {}
    })
    const [title, caption] = titleAndCaption(row)
    expect(caption.props.children).toBe('Plan')
    expect(title.props.children).toBe('Mode')
    expect(row.props.accessibilityLabel).toBe('Mode')
    expect(styleOf(title.props.style).color).toBe(palette.text)
    expect(styleOf(caption.props.style).color).toBe(palette.textSecondary)
  })

  it('says "Mode: Default" on a Codex tab out of Plan mode', async () => {
    const footer = parseCodexHudObservation(CODEX_DEFAULT_FOOTER)!
    expect(footer).toMatchObject({ agentMode: 'default', permissionMode: 'default' })
    const row = await modeRow(scheme, {
      agent: 'codex',
      permissionMode: footer.permissionMode,
      agentMode: footer.agentMode,
      onSelectAgentMode: () => {}
    })
    const [title, caption] = titleAndCaption(row)
    expect(caption.props.children).toBe('Default')
    expect(title.props.children).toBe('Mode')
  })

  it("keeps a Claude tab's Permission caption", async () => {
    const row = await modeRow(scheme, {
      agent: 'claude',
      permissionMode: 'acceptEdits',
      onSelectPermissionMode: () => {}
    })
    const [title, caption] = titleAndCaption(row)
    expect(title.props.children).toBe('Permission')
    expect(caption.props.children).toBe('Accept edits')
    expect(row.props.accessibilityLabel).toBe('Permission mode')
    expect(styleOf(caption.props.style).color).toBe(palette.textSecondary)
  })
})
