import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The session header's title on a Claude chat matched to its Anthropic session: the session's own
 * title, as the Claude app's header shows it (1.261013.20), in the header's existing type and the
 * theme's text colour in light and dark. Every other tab keeps the worktree name.
 */

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: ({ children, style, ...props }: { children?: unknown; style?: unknown }) =>
      React.createElement(
        'Pressable',
        { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style },
        typeof children === 'function' ? children({ pressed: false }) : children
      ),
    ScrollView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react')
  return {
    SafeAreaView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('SafeAreaView', props, children)
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }))
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
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, children) : null
  }
})
vi.mock('../ui/IconButton', async () => {
  const React = await import('react')
  return {
    IconButton: ({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress?: () => void }) =>
      React.createElement('IconButton', { accessibilityLabel, onPress })
  }
})
vi.mock('../ui/StatusPulse', () => ({ StatusPulse: () => null }))
vi.mock('./QuickCommandsTabButton', () => ({ QuickCommandsTabButton: () => null }))
// The tab strip's agent marks load PNG assets; the strip is empty here.
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../components/AgentStateDot', () => ({ AgentStateDot: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, fontFamily, lightColors, type, type ThemeColors } from '../theme/tokens'
import { MobileSessionHeader } from './MobileSessionHeader'
import type { MobileSessionController } from './use-mobile-session-controller'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function controller(overrides: {
  usedTokens?: number | null
  showNativeChat?: boolean
  branch?: string
  connState?: 'connected' | 'disconnected'
  showHeaderMoreButton?: boolean
  floating?: boolean
  terminalSummary?: string
  anthropicTitle?: string | null
}): MobileSessionController {
  const ref = <T,>(current: T) => ({ current })
  return {
    hostId: 'host-1',
    worktreeId: 'repo-1::/work/header',
    client: { sendRequest: vi.fn(), subscribe: vi.fn(() => () => {}) },
    lastConnectedAt: 1,
    isFolderWorkspaceRoute: false,
    isFloatingWorkspaceRoute: overrides.floating ?? false,
    connState: overrides.connState ?? 'connected',
    forceReconnectHost: null,
    worktreeName: 'Header parity',
    worktreeBranch: overrides.branch ?? 'refs/heads/feature/header',
    activePanel: null,
    activeSessionTabId: 'tab-1',
    activeSessionTabIdRef: ref('tab-1'),
    tabStripRef: ref(null),
    tabStripOffsetRef: ref(0),
    tabStripViewportWidthRef: ref(0),
    tabStripContentWidthRef: ref(0),
    tabLayoutsRef: ref(new Map()),
    creating: false,
    creatingBrowser: false,
    creatingMarkdown: false,
    setCreateError: () => {},
    setShowCreateTabDrawer: () => {},
    setShowQuickCommands: () => {},
    setShowHeaderMoreActions: () => {},
    quickCommandsSupported: true,
    showToast: () => {},
    requestLeaveSession: () => {},
    scrollActiveTabIntoView: () => {},
    switchSessionTab: () => {},
    openSessionTabActionSheetAfterKeyboardDismiss: () => {},
    visibleTabs: [],
    showConnectionRetry: false,
    terminalSummary: overrides.terminalSummary ?? '1 tab',
    handlePanelTap: () => {},
    showHeaderMoreButton: overrides.showHeaderMoreButton ?? true,
    terminalsLoaded: true,
    switchTabView: async () => {},
    nativeChatController: {
      activeChatEligible: true,
      showNativeChat: overrides.showNativeChat ?? true,
      nativeChatLiveModel: null,
      nativeChatLeadTurnEnded: false,
      nativeChatContextWindow: null,
      nativeChatAgentStatus: null,
      nativeChatContextUsedTokens: overrides.usedTokens ?? null,
      nativeChatSessionIdentity: { sessionId: null, transcriptPath: null, nestedSessionId: null },
      nativeChatAnthropicSession:
        overrides.anthropicTitle === undefined
          ? null
          : { sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', title: overrides.anthropicTitle, resolveTarget: () => ({ kind: 'refused', reason: 'unmatched' }) }
    }
  } as unknown as MobileSessionController
}

async function mount(scheme: 'light' | 'dark', input: Parameters<typeof controller>[0]): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileSessionHeader, { controller: controller(input) })}
      </ThemeProvider>
    )
  })
  // Let any effects settle.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter((entry) => Boolean(entry) && typeof entry === 'object'))
}

const textOf = (node: ReactTestInstance): string => [node.props.children].flat().join('')
const texts = (): ReactTestInstance[] => renderer!.root.findAll((node) => String(node.type) === 'Text')
const textNode = (value: string): ReactTestInstance | undefined => texts().find((node) => textOf(node) === value)

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the header of a Claude chat in %s mode', (scheme, palette) => {
  it('shows the Anthropic session title in the header type and text colour', async () => {
    await mount(scheme, { anthropicTitle: 'CI failure on main' })
    expect(textNode('Header parity'), 'the worktree name is not the title').toBeUndefined()
    const title = textNode('CI failure on main')
    expect(title, `title among ${texts().map(textOf).join(' | ')}`).toBeDefined()
    expect(flat(title!.props.style)).toMatchObject({ fontSize: type.heading.size, fontFamily: fontFamily.semibold, color: palette.text })
  })

  it('keeps the worktree name while the session has no title', async () => {
    await mount(scheme, { anthropicTitle: null })
    expect(textNode('Header parity')).toBeDefined()
  })

  it('keeps the worktree name on a tab with no Anthropic session', async () => {
    await mount(scheme, {})
    expect(textNode('Header parity')).toBeDefined()
  })
})
