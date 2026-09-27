import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors, type ThemePreference } from '../theme/tokens'
import { ThemeProvider, useTheme } from '../theme/theme-context'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import { QuickCommandsSheet } from './QuickCommandsSheet'

// A quick-command row reads `colors` and `styles` off the live theme now, not the static
// `mobile-theme` import it used before the sweep. A row that keeps a memoized reference to either
// without listing it as a dependency would keep painting the scheme it first opened under, the
// same shape of bug fixed in MobileGitHistoryList.tsx (review of fix/theme-review, 2026-09-27).
// This mounts the sheet's list, switches the theme preference live, and checks the row repaints.

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  Copy: 'Copy',
  Pencil: 'Pencil',
  Play: 'Play',
  Plus: 'Plus',
  Search: 'Search',
  Trash2: 'Trash2'
}))

vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))

vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../platform/haptics', () => ({ triggerError: vi.fn() }))

vi.mock('./QuickCommandEditorForm', () => ({
  QuickCommandEditorForm: 'QuickCommandEditorForm'
}))

const COMMAND: TerminalQuickCommand = {
  id: 'command-1',
  label: 'Run tests',
  action: 'terminal-command',
  command: 'pnpm test',
  appendEnter: true,
  scope: { type: 'global' }
}

vi.mock('./use-quick-commands', () => ({
  useQuickCommands: () => ({
    commands: [COMMAND],
    loading: false,
    ready: true,
    error: null,
    persist: vi.fn()
  })
}))

let switchTo: ((preference: ThemePreference) => void) | null = null

function Switcher(): null {
  switchTo = useTheme().setPreference
  return null
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('a quick-command row after an appearance change', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    switchTo = null
  })

  it('repaints the row label and icon in the new theme', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Switcher />
          {createElement(QuickCommandsSheet, {
            visible: true,
            onClose: () => undefined,
            client: null,
            repoId: null,
            repoName: null,
            onLaunch: () => true
          })}
        </ThemeProvider>
      )
    })

    const paint = () => {
      const label = renderer!.root
        .findAllByType('Text' as never)
        .find((node) => node.props.children === 'Run tests')!
      const playIcon = renderer!.root.findByType('Play' as never)
      return { label: styleOf(label).color, icon: playIcon.props.color as string }
    }

    expect(paint()).toEqual({ label: lightColors.text, icon: lightColors.text })

    act(() => {
      switchTo!('dark')
    })

    expect(paint()).toEqual({ label: darkColors.text, icon: darkColors.text })
  })
})
