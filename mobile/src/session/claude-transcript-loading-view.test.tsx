import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('@shopify/flash-list', async () => {
  const React = await import('react')
  return {
    // The footer is the visual top of the inverted list, where older history loads.
    FlashList: ({
      data,
      renderItem,
      ListFooterComponent
    }: {
      data: NativeChatMessage[]
      renderItem: (info: { item: NativeChatMessage; index: number }) => ReactNode
      ListFooterComponent?: ReactNode
    }) =>
      React.createElement(
        'FlashList',
        null,
        data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index }))),
        ListFooterComponent
      )
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Platform: { OS: 'android', select: (options: { android?: unknown; default?: unknown }) => options.android ?? options.default },
    Animated: {
      View: host('AnimatedView'),
      Text: host('Text'),
      createAnimatedComponent: (component: unknown) => component,
      Value: class {
        interpolate() {
          return 0
        }
        setValue() {}
      },
      loop: () => ({ start: () => {}, stop: () => {} }),
      timing: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({ start: () => {}, stop: () => {} })
    },
    Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
    // The chat's follow hook listens for the app leaving the foreground
    // (use-app-interruptions.ts, hold to copy, 6a1810e0).
    AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', G: 'G', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain = { runOnJS: () => chain, onStart: () => chain, onUpdate: () => chain }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  Brain: 'Brain',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  Square: 'Square',
  SquareChevronRight: 'SquareChevronRight',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
// A sheet draws its content only while open: a thought's sheet holds its words.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, children) : null
  }
})
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
// The inline-visual provider imports a WebView; this view's rows draw no visuals here (#26071).
vi.mock('./MobileNativeChatVisual', () => ({
  MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children
}))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))

// The Claude app 1.261009.20 draws a Code session's transcript loading as Clawd dancing above
// "Loading session…", centred in the list (`yv8` item "loading" → `mu20.d`), and a plain 20 dp
// spinner only for older history (`yv8` item "history_spinner" → `yv8.t`). Code UI drew a bare
// ActivityIndicator for the first open (reported 2026-10-15).

function user(id: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: 0, source: 'transcript' }
}
function prose(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(node.props.style).flat(Infinity).filter(Boolean))
}

describe('a Claude tab opening its transcript', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.unstubAllGlobals()
  })

  async function draw(
    scheme: 'light' | 'dark',
    props: { agent: string; status: 'loading' | 'ready'; messages: NativeChatMessage[]; hasMore?: boolean; loadingEarlier?: boolean }
  ): Promise<void> {
    await act(async () => {
      const screen = (
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatView
            agent={props.agent}
            messages={props.messages}
            folded={foldMobileNativeChatMessages(props.messages)}
            status={props.status}
            hasMore={props.hasMore}
            loadingEarlier={props.loadingEarlier}
            onLoadEarlier={vi.fn()}
            streaming={null}
            onSend={vi.fn().mockResolvedValue(true)}
            sendSurfaceId="tab-a"
            getSendCompletionGeneration={() => 0}
            getComposerEditGeneration={() => 0}
            pending={[]}
            composerText=""
            onComposerTextChange={vi.fn()}
          />
        </ThemeProvider>
      )
      if (renderer) {
        renderer.update(screen)
      } else {
        renderer = create(screen)
      }
    })
  }

  const clawd = () => renderer!.root.findAll((node) => node.props.testID === 'claude-transcript-loading-clawd' && typeof node.type === 'string')
  const spinners = () => renderer!.root.findAll((node) => node.type === ('ActivityIndicator' as never))
  const loadingLabel = () =>
    renderer!.root.findAll((node) => node.type === ('Text' as never) && node.props.children === 'Loading session…')

  it.each(SCHEMES)("shows the Claude app's loading mark, not a spinner, in %s", async (scheme, colors) => {
    await draw(scheme, { agent: 'claude', status: 'loading', messages: [] })
    expect(clawd()).toHaveLength(1)
    expect(spinners()).toHaveLength(0)
    // The label is the app's `ccr_loading_session` in its primary text colour (`pl7.O`).
    expect(loadingLabel()).toHaveLength(1)
    expect(flatStyle(loadingLabel()[0]!).color).toBe(colors.text)
  })

  it.each(SCHEMES)('lets the mark go once the first page lands, in %s', async (scheme) => {
    await draw(scheme, { agent: 'claude', status: 'loading', messages: [] })
    expect(clawd()).toHaveLength(1)
    await draw(scheme, { agent: 'claude', status: 'ready', messages: [user('u1'), prose('a1', 'Hello.')] })
    expect(clawd()).toHaveLength(0)
    expect(loadingLabel()).toHaveLength(0)
  })

  it.each(SCHEMES)('keeps the plain spinner, not Clawd, while older history loads, in %s', async (scheme) => {
    await draw(scheme, {
      agent: 'claude',
      status: 'ready',
      messages: [user('u1'), prose('a1', 'Hello.')],
      hasMore: true,
      loadingEarlier: true
    })
    expect(clawd()).toHaveLength(0)
    expect(spinners()).toHaveLength(1)
  })

  it.each(SCHEMES)("leaves a Codex tab's loading spinner alone (Clawd is Claude's), in %s", async (scheme) => {
    await draw(scheme, { agent: 'codex', status: 'loading', messages: [] })
    expect(clawd()).toHaveLength(0)
    expect(spinners()).toHaveLength(1)
  })
})
