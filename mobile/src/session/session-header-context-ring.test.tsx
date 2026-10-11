import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The session header's context ring, moved from the composer to where the Claude app's top bar
 * draws it (com.anthropic.claude 1.261009.20, `us8`/`d5a`, parity gap G9): among the trailing
 * actions, blue under 75%, amber to 89%, red from 90%. The title and subline keep their existing
 * look: the user had the size changes reverted on 2026-10-11. Light and dark are both required.
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
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function controller(overrides: {
  context?: TerminalHudContextWindow | null
  usedTokens?: number | null
  showNativeChat?: boolean
  branch?: string
  connState?: 'connected' | 'disconnected'
  showHeaderMoreButton?: boolean
  floating?: boolean
  terminalSummary?: string
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
      nativeChatContextWindow: overrides.context ?? null,
      nativeChatAgentStatus: null,
      nativeChatContextUsedTokens: overrides.usedTokens ?? null,
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
  it('keeps the title and subline as they were: heading semibold, caption tab count', async () => {
    await mount(scheme, {})
    const title = textNode('Header parity')
    expect(title, 'the title').toBeDefined()
    expect(flat(title!.props.style)).toMatchObject({
      fontSize: type.heading.size,
      fontFamily: fontFamily.semibold,
      color: palette.text
    })
    const subline = textNode('1 tab')
    expect(subline, `subline among ${texts().map(textOf).join(' | ')}`).toBeDefined()
    expect(flat(subline!.props.style)).toMatchObject({ fontSize: type.caption.size, color: palette.textSecondary })
  })

  // Parity gap G35: the menu carries Copy branch and Rename now, so it is drawn for them alone.
  it('draws the session menu for its session entries even with no project screens to offer', async () => {
    await mount(scheme, { showHeaderMoreButton: false })
    const more = renderer!.root.findAll(
      (node) => String(node.type) === 'IconButton' && node.props.accessibilityLabel === 'More session actions'
    )
    expect(more).toHaveLength(1)
  })

  it('draws no menu when nothing in it applies', async () => {
    await mount(scheme, { showHeaderMoreButton: false, floating: true, branch: '' })
    const more = renderer!.root.findAll(
      (node) => String(node.type) === 'IconButton' && node.props.accessibilityLabel === 'More session actions'
    )
    expect(more).toHaveLength(0)
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

  // Carried over from the composer's ring (849b0843), which these replaced.
  it('still opens from a screen reader’s click, which has no press-in', async () => {
    await mount(scheme, { context: context(40) })
    await act(async () => (ring()!.props.onPress as () => void)())
    expect(renderer!.root.findAll((node) => String(node.type) === 'BottomDrawer')).toHaveLength(1)
  })

  it('stays open when the release follows the press-in', async () => {
    await mount(scheme, { context: context(40) })
    await act(async () => (ring()!.props.onPressIn as () => void)())
    await act(async () => (ring()!.props.onPress as () => void)())
    expect(renderer!.root.findAll((node) => String(node.type) === 'BottomDrawer'), 'the release toggled the sheet shut').toHaveLength(1)
  })

  it('opens the sheet from the token count too, and the sheet says the window is unknown', async () => {
    await mount(scheme, { usedTokens: 493_000 })
    await act(async () => (ring()!.props.onPressIn as () => void)())
    expect(textNode('493k used')).toBeDefined()
  })

  it('shows the tokens and no ring or percentage when the session stated no window', async () => {
    await mount(scheme, { usedTokens: 493_000 })
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
