// Which rows the chat list hands "Rewind to here" to. Split from
// MobileNativeChatView.test.ts, which sits at its line cap.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
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
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))
vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }))
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
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Sparkles: 'Sparkles',
  Square: 'Square'
}))
// Both sheets reach BottomDrawer, whose styles call Platform.select at import.
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('./MobileNativeChatAgentRunSheet', () => ({ MobileNativeChatAgentRunSheet: 'AgentRunSheet' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('./MobileNativeChatStatusLine', () => ({ MobileNativeChatStatusLine: 'StatusLine' }))
vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

function assistant(id: string, text: string): NativeChatMessage {
  return { ...user(id, text), role: 'assistant' }
}

const MESSAGES = [user('u1', 'first'), assistant('a1', 'reply'), user('u2', 'second')]

describe('which rows the chat list offers Rewind to here on', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.unstubAllGlobals()
  })

  async function render(overrides: Partial<Parameters<typeof MobileNativeChatView>[0]>): Promise<void> {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatView, {
          messages: MESSAGES,
          folded: MESSAGES,
          status: 'ready',
          streaming: null,
          onSend: vi.fn().mockResolvedValue(true),
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          pending: [],
          composerText: '',
          onComposerTextChange: vi.fn(),
          structuredActivityUi: true,
          ...overrides
        })
      )
    })
  }

  function rowProps(id: string): Record<string, unknown> {
    const list = renderer!.root.find((node) => node.type === 'FlashList')
    const data = list.props.data as NativeChatMessage[]
    const index = data.findIndex((row) => row.id === id)
    const row = list.props.renderItem({ item: data[index], index }) as {
      props: { children: [unknown, { props: Record<string, unknown> }] }
    }
    return row.props.children[1].props
  }

  it('hands it to the journalled user rows, and to nothing else', async () => {
    const onRewindToMessage = vi.fn(async () => true)
    await render({
      onRewindToMessage,
      pending: [{ id: 'pending-1', text: 'queued' }]
    })
    expect(rowProps('u1').onRewindToHere).toEqual(expect.any(Function))
    expect(rowProps('u2').onRewindToHere).toEqual(expect.any(Function))
    expect(rowProps('a1').onRewindToHere).toBeUndefined()
    // A queued echo is drawn but has no journal item the host could name.
    expect(rowProps('pending-1').onRewindToHere).toBeUndefined()
  })

  it('hands it to no row at all on a lane that cannot rewind', async () => {
    await render({ onRewindToMessage: undefined })
    expect(rowProps('u1').onRewindToHere).toBeUndefined()
    expect(rowProps('u2').onRewindToHere).toBeUndefined()
  })
})
