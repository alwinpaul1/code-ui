import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
// The system interrupting a touch is not what these tests are about; see
// use-mobile-native-chat-tail-follow.settle.test.ts for that.
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  // The list sizes its render-ahead window from the screen, so the stub has to
  // report one — a Galaxy S23's 2316px at density 2.8125.
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))

vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Sparkles: 'Sparkles',
  Square: 'Square'
}))

// The sheet reaches BottomDrawer, whose styles call Platform.select — absent
// from this file's react-native mock, and irrelevant to the banner tests.
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: 'BackgroundTasksSheet'
}))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
// The Rewind confirm sheet reaches the same drawer; its rows are covered in
// MobileNativeChatView-rewind.test.ts.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileNativeChatSessionBar', () => ({ MobileNativeChatSessionBar: 'SessionBar' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
// The inline-visual provider imports a WebView; this view's rows draw no visuals here (#26071).
vi.mock('./MobileNativeChatVisual', () => ({
  MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children
}))
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: {
      onSend: (text: string) => Promise<boolean>
      disabled?: boolean
      placeholder?: string
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

// G6 (Claude app parity): the session bar sits in the dock right above the
// composer, fed the newest plan in the transcript (Claude Code's TaskCreate /
// TaskUpdate calls included) and the worktree's diff. Before it, the dock held
// a "Tasks n/m" strip that only TodoWrite and update_plan could fill.

const REBUILD = 'Rebuild all seven screens per Tiles of Fact spec via six parallel screen agents'
const planTurn: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  timestamp: 0,
  source: 'transcript',
  blocks: [
    { type: 'tool-call', name: 'TaskCreate', callId: 't1', state: 'completed', input: { subject: REBUILD, activeForm: 'Rebuilding' } },
    { type: 'tool-result', callId: 't1', output: `Task #7 created successfully: ${REBUILD}` }
  ]
}

describe('MobileNativeChatView, the session bar above the composer', () => {
  let renderer: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(extra: Partial<Parameters<typeof MobileNativeChatView>[0]>): Promise<void> {
    const messages = [planTurn]
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatView, {
          messages,
          folded: foldMobileNativeChatMessages(messages),
          status: 'ready',
          streaming: null,
          onSend: vi.fn().mockResolvedValue(true),
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          pending: [],
          composerText: '',
          onComposerTextChange: vi.fn(),
          agentWorking: true,
          ...extra
        })
      )
    })
  }

  it('hands the bar the plan Claude Code built with its Task tools, the diff, and the opener', async () => {
    const onOpenDiff = vi.fn()
    await render({ sessionDiff: { files: 2, added: 9, removed: 4 }, onOpenDiff })
    const bar = renderer!.root.find((node) => String(node.type) === 'SessionBar')
    expect(bar.props.list).toEqual({ tasks: [{ content: REBUILD, status: 'pending', activeForm: 'Rebuilding' }] })
    expect(bar.props.diff).toEqual({ files: 2, added: 9, removed: 4 })
    expect(bar.props.onOpenDiff).toBe(onOpenDiff)
    expect(bar.props.working).toBe(true)
  })

  it('sits in the dock directly above the composer', async () => {
    await render({})
    const dock = renderer!.root.find((node) => node.props.testID === 'native-chat-dock' && String(node.type) === 'View')
    const kids = dock.children.filter((child): child is ReturnType<typeof dock.find> => typeof child !== 'string')
    const types = kids.map((child) => String(child.type))
    const bar = types.indexOf('SessionBar')
    expect(bar).toBeGreaterThanOrEqual(0)
    expect(kids[bar + 1]!.findAll((n) => String(n.type) === 'Composer')).toHaveLength(1)
  })
})
