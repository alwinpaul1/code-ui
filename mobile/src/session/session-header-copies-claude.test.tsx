import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The session header copied from the Claude app's top bar (com.anthropic.claude 1.261009.20,
 * `yv8`/`us8`, parity gap G9): the title in Sans 15 semibold (the app's 550; Instrument Sans has no
 * 550), a "repo · branch" subtitle, and the context ring among the trailing actions, blue under
 * 75%, amber to 89%, red from 90%. Light and dark are both required states.
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
import { darkColors, fontFamily, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileSessionHeader } from './MobileSessionHeader'
import type { MobileSessionController } from './use-mobile-session-controller'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** A host that answers `repo.list` with the workspace's repo, as Orca 1.4.205 does. */
function repoListClient(displayName: string) {
  return {
    sendRequest: vi.fn(async (method: string) =>
      method === 'repo.list'
        ? { id: 'repos', ok: true, result: { repos: [{ id: 'repo-1', displayName }] }, _meta: { runtimeId: 'r' } }
        : { id: 'x', ok: false, error: { code: 'method_not_found', message: method }, _meta: { runtimeId: 'r' } }
    ),
    subscribe: vi.fn(() => () => {}),
    getState: () => 'connected'
  }
}

function controller(overrides: {
  context?: TerminalHudContextWindow | null
  agentStatus?: Record<string, unknown> | null
  showNativeChat?: boolean
  branch?: string
  connState?: 'connected' | 'disconnected'
  terminalSummary?: string
}): MobileSessionController {
  const ref = <T,>(current: T) => ({ current })
  return {
    hostId: 'host-1',
    worktreeId: 'repo-1::/work/header',
    client: repoListClient('orca'),
    lastConnectedAt: 1,
    isFolderWorkspaceRoute: false,
    isFloatingWorkspaceRoute: false,
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
    showHeaderMoreButton: true,
    terminalsLoaded: true,
    switchTabView: async () => {},
    nativeChatController: {
      activeChatEligible: true,
      showNativeChat: overrides.showNativeChat ?? true,
      nativeChatLiveModel: null,
      nativeChatLeadTurnEnded: false,
      nativeChatContextWindow: overrides.context ?? null,
      nativeChatAgentStatus: overrides.agentStatus ?? null,
      nativeChatSessionIdentity: { sessionId: null, transcriptPath: null, nestedSessionId: null }
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
  // The repo name arrives from the host's answer.
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
const ring = (): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'View usage')[0]
const arcStroke = (): unknown =>
  ring()
    ?.findAll((node) => String(node.type) === 'Circle')
    .map((node) => node.props.stroke)
    .at(-1)

const context = (usedPercent: number): TerminalHudContextWindow => ({ usedPercent, usedLabel: '160.0k', windowLabel: '200.0k' })

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the session header in %s mode', (scheme, palette) => {
  it('draws the title in Sans 15 semibold, one line', async () => {
    await mount(scheme, {})
    const title = textNode('Header parity')
    expect(title, 'the title').toBeDefined()
    const style = flat(title!.props.style)
    expect(style.fontSize).toBe(15)
    expect(style.fontFamily).toBe(fontFamily.semibold)
    expect(style.color).toBe(palette.text)
    expect(title!.props.numberOfLines).toBe(1)
  })

  it('reads "repo · branch" under the title, in the secondary ink at 13', async () => {
    await mount(scheme, {})
    const subtitle = textNode('orca · feature/header')
    expect(subtitle, `subtitle among ${texts().map(textOf).join(' | ')}`).toBeDefined()
    const style = flat(subtitle!.props.style)
    expect(style.fontSize).toBe(13)
    expect(style.color).toBe(palette.textSecondary)
  })

  it('says the connection state instead of "repo · branch" while the link is down', async () => {
    await mount(scheme, { connState: 'disconnected', terminalSummary: 'Disconnected' })
    expect(textNode('Disconnected')).toBeDefined()
    expect(textNode('orca · feature/header')).toBeUndefined()
  })

  it('shows the repo alone on a detached HEAD', async () => {
    await mount(scheme, { branch: '' })
    // The repo still answers, so the repo half alone stands.
    expect(textNode('orca')).toBeDefined()
  })

  it.each([
    [40, 'info'],
    [75, 'warning'],
    [89, 'warning'],
    [90, 'danger']
  ] as const)('puts the context ring in the header at %i percent in the theme %s colour', async (percent, token) => {
    await mount(scheme, { context: context(percent) })
    expect(ring(), 'the ring in the header').toBeDefined()
    expect(ring()!.props.accessibilityValue).toEqual({ text: `${percent}% used` })
    expect(arcStroke()).toBe(palette[token])
  })

  it('opens the context sheet from the ring as the finger lands', async () => {
    await mount(scheme, { context: context(40) })
    await act(async () => (ring()!.props.onPressIn as () => void)())
    expect(renderer!.root.findAll((node) => String(node.type) === 'BottomDrawer')).toHaveLength(1)
  })

  it('shows the tokens and no ring or percentage when the session stated no window', async () => {
    await mount(scheme, { agentStatus: { contextUsedTokens: 493_000 } })
    expect(renderer!.root.findAll((node) => String(node.type) === 'Circle')).toHaveLength(0)
    const tokens = textNode('493k')
    expect(tokens, `tokens among ${texts().map(textOf).join(' | ')}`).toBeDefined()
    expect(texts().some((node) => /%/.test(textOf(node)))).toBe(false)
  })

  it('shows no ring at all when nothing is known', async () => {
    await mount(scheme, {})
    expect(ring()).toBeUndefined()
    expect(renderer!.root.findAll((node) => String(node.type) === 'Circle')).toHaveLength(0)
  })

  it('shows no ring over the terminal view, where the chat HUD is not reading', async () => {
    await mount(scheme, { context: context(40), showNativeChat: false })
    expect(ring()).toBeUndefined()
  })
})
