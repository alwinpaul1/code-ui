import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The user, 2026-10-14, over screenshots of the composer: the mode chip next to the + ("the
// lightning chip") goes, because the + "Add context" sheet already has a "Permission" row that
// names the mode and opens the same Select mode sheet (docs/claude-app-parity-gaps.md, G4).
// Commit 19259499e had put the chip there; this pins that the composer's leading group is the +
// and the model pill alone, in both schemes, on every mode a Claude tab can state.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Keyboard: { dismiss: () => {}, isVisible: () => false, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
    Switch: 'Switch',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 384, height: 823 })
  }
})
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

type ComposerProps = ComponentProps<typeof MobileNativeChatComposer>

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function renderComposer(scheme: 'light' | 'dark', props: Partial<ComposerProps>): void {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: '',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          onAttachImage: () => {},
          onAttachFile: () => {},
          onMicPress: () => {},
          ...props
        } as ComposerProps)}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => true }) }
    )
  })
}

const rowButtons = (): string[] =>
  renderer!.root
    .find((node) => node.props.testID === 'native-chat-composer-actions')
    .findAll((node) => (node.type as unknown) === 'Pressable')
    .map((node) => String(node.props.accessibilityLabel))

describe.each(['light', 'dark'] as const)('the composer has no mode chip, %s', (scheme) => {
  it.each<TerminalPermissionMode>(['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'])(
    'draws no "Change mode" button on a Claude tab in %s mode, with a way to change it',
    (permissionMode) => {
      renderComposer(scheme, { agent: 'claude', permissionMode, onSelectPermissionMode: () => {} })
      expect(rowButtons()).not.toContain('Change mode')
    }
  )

  it('keeps the + and the mic, so the row is not emptied with the chip', () => {
    renderComposer(scheme, { agent: 'claude', permissionMode: 'auto', onSelectPermissionMode: () => {} })
    expect(rowButtons()).toEqual(expect.arrayContaining(['Add to chat', 'Dictate']))
  })

  it('draws none on a Codex tab either, where its own mode row lives in the + sheet', () => {
    renderComposer(scheme, { agent: 'codex', agentMode: 'plan', permissionMode: 'default', onSelectAgentMode: () => {} })
    expect(rowButtons()).not.toContain('Change mode')
  })
})
