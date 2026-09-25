import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
// First, ahead of anything that loads react-native: the mock below draws with the list double.
import {
  createAnsweringClient,
  flatStyle,
  historyReplies,
  historySession,
  SectionListDouble
} from './agent-history-panel.test-support'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { RpcClient } from '../transport/rpc-client'

/**
 * The history screen follows the appearance setting.
 *
 * It was drawn from the dark-only legacy palette, so a phone set to Light got a dark history screen
 * inside an otherwise light app. Every colour now comes from the theme; these pin the canvas, a
 * row, and the icon colours that are props rather than styles in both schemes, because a hardcoded
 * colour passes every other check.
 */

const host = vi.hoisted((): { client: RpcClient | null } => ({ client: null }))

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  usePathname: () => '/'
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  SectionList: SectionListDouble,
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android', select: (choices: Record<string, unknown>) => choices.android },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Chevron', Play: 'Play', RefreshCw: 'Refresh' }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {}, triggerSuccess: () => {} }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ push: () => {}, back: () => {}, canGoBack: () => false })
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => null,
  useHostClient: () => ({ client: host.client, state: 'connected', clientId: null })
}))
// The search panel names the host from the store; the page's own store answers from `init.host`,
// where the native one reaches a keychain this test does not have.
vi.mock('../transport/host-store', async () => await import('../transport/host-store.web'))

import { MobileAgentSessionHistoryPanel } from './MobileAgentSessionHistoryPanel'

let tree: ReactTestRenderer | null = null

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  host.client = null
})

async function mountPanel(scheme: 'light' | 'dark'): Promise<ReactTestRenderer> {
  host.client = createAnsweringClient(historyReplies([historySession()])).client
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileAgentSessionHistoryPanel hostId="host-a" worktreeId="wt-1" name="app" />
      </ThemeProvider>
    )
  })
  if (tree === null) {
    throw new Error('the panel did not mount')
  }
  return tree
}

function textNode(rendered: ReactTestRenderer, text: string): ReactTestInstance {
  const [node] = rendered.root.findAll(
    (candidate) => String(candidate.type) === 'Text' && candidate.props.children === text
  )
  if (!node) {
    throw new Error(`no text "${text}" on screen`)
  }
  return node
}

describe('the agent-history screen in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its canvas, rows and icons from the %s theme', async (scheme, palette) => {
    const rendered = await mountPanel(scheme)
    const [canvas] = rendered.root.findAll((node) => String(node.type) === 'View')
    expect(flatStyle(canvas?.props.style).backgroundColor).toBe(palette.bg)
    expect(flatStyle(textNode(rendered, 'Agent Session History').props.style).color).toBe(
      palette.text
    )
    expect(flatStyle(textNode(rendered, 'Implement vault filters').props.style).color).toBe(
      palette.text
    )
    const input = rendered.root.find((node) => String(node.type) === 'TextInput')
    expect(input.props.placeholderTextColor).toBe(palette.textMuted)
    const chevron = rendered.root.find((node) => String(node.type) === 'Chevron')
    expect(chevron.props.color).toBe(palette.textSecondary)
    const play = rendered.root.find((node) => String(node.type) === 'Play')
    expect(play.props.color).toBe(palette.text)
    const refresh = rendered.root.find((node) => String(node.type) === 'RefreshControl')
    expect(refresh.props.tintColor).toBe(palette.textSecondary)
  })

  it('does not paint the two schemes alike, so the pins above can tell them apart', () => {
    expect(lightColors.bg).not.toBe(darkColors.bg)
    expect(lightColors.text).not.toBe(darkColors.text)
    expect(lightColors.textSecondary).not.toBe(darkColors.textSecondary)
    expect(lightColors.textMuted).not.toBe(darkColors.textMuted)
  })
})
