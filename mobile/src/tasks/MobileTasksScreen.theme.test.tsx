import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Tasks screen in both themes, rendered through its real 36-stage hook pipeline, with a host
 * that is not connected (the state a user sees before the relay comes up).
 *
 * Every file on this surface took `colors` from `mobile-tasks-dependencies`, which re-exported the
 * LEGACY static palette from `mobile-theme.ts`, and its seven StyleSheets were built from it at
 * module load. The 2026-09-27 sweep looked for `colors` imported from `mobile-theme` and missed
 * this re-export, so in a light session the whole Tasks screen (header, status bar, provider
 * switcher, search, list, every drawer) still drew the dark palette.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { addListener: () => ({ remove: () => undefined }), dismiss: () => undefined },
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  Linking: { openURL: async () => undefined },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('lucide-react-native', () => {
  const icon = (name: string) => (props: Record<string, unknown>) => createElement(name, props)
  return Object.fromEntries(
    [
      'AlertTriangle',
      'Check',
      'ChevronDown',
      'ChevronLeft',
      'ChevronRight',
      'ChevronUp',
      'Copy',
      'ExternalLink',
      'GitBranch',
      'Lock',
      'Pencil',
      'Plus',
      'RefreshCw',
      'Search',
      'Send',
      'Terminal',
      'X'
    ].map((name) => [name, icon(name)])
  )
})
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'disconnected' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null,
  useReconnectAttempt: () => 0,
  useRelayRecoveryStatus: () => ({})
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn(), triggerSelection: vi.fn() }))
vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))
vi.mock('../platform/clipboard', () => ({
  useClipboardWriter: () => ({ writeText: async () => undefined }),
  useClipboardReader: () => ({})
}))
// Drawers and pickers are closed on a fresh screen; they render nothing here.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))
vi.mock('../components/PickerModal', () => ({ PickerModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: () => null }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../components/TaskProviderLogo', () => ({
  TaskProviderLogo: (props: Record<string, unknown>) => createElement('TaskProviderLogo', props)
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileTasksScreen } from './MobileTasksScreen'

function flat(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? style({ pressed: false }) : style
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const text = (root: ReactTestInstance, children: string): ReactTestInstance =>
  root.findAll(
    (node) => String(node.type) === 'Text' && [node.props.children].flat().join('') === children
  )[0]!

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('the Tasks screen in a %s session', (scheme, palette) => {
  it('draws its canvas, header, toolbar and loading list from the theme', async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme as 'light' | 'dark'}>
          <MobileTasksScreen />
        </ThemeProvider>
      )
    })
    const root = renderer!.root
    const canvas = root.find((node) => String(node.type) === 'SafeAreaView')
    expect(flat(canvas.props.style).backgroundColor).toBe(palette.bg)
    // The chrome above the list: its panel, the title and the Back chevron.
    const chrome = root.findAll((node) => String(node.type) === 'View')[0]!
    expect(flat(chrome.props.style)).toMatchObject({
      backgroundColor: palette.bgPanel,
      borderBottomColor: palette.border
    })
    expect(flat(text(root, 'Tasks').props.style).color).toBe(palette.text)
    expect(root.findAll((node) => String(node.type) === 'ChevronLeft')[0]!.props.color).toBe(
      palette.text
    )
    // The provider switcher in the toolbar under it.
    const provider = text(root, 'GitHub')
    expect(flat(provider.props.style).color).toBe(palette.text)
    expect(root.find((node) => String(node.type) === 'TaskProviderLogo').props.color).toBe(
      palette.text
    )
    expect(flat(text(root, 'All repos').props.style).color).toBe(palette.textSecondary)
    // The list, still loading while the host is away.
    expect(root.find((node) => String(node.type) === 'ActivityIndicator').props.color).toBe(
      palette.textSecondary
    )
  })
})
