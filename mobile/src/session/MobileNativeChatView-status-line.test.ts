import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
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
vi.mock('./MobileNativeChatAgentRunSheet', () => ({
  MobileNativeChatAgentRunSheet: 'AgentRunSheet'
}))
// The Rewind confirm sheet reaches the same drawer; its rows are covered in
// MobileNativeChatView-rewind.test.ts.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
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

type Overrides = {
  messages?: Parameters<typeof MobileNativeChatView>[0]['messages']
  folded?: Parameters<typeof MobileNativeChatView>[0]['folded']
  streaming?: string | null
  sendErrorMessage?: string | null
  onClearSendError?: () => void
  inputLockReason?: 'disconnected' | 'waiting' | null
  onSend?: (text: string) => Promise<boolean>
  pending?: Parameters<typeof MobileNativeChatView>[0]['pending']
  hasMore?: boolean
  onLoadEarlier?: () => void
  structuredActivityUi?: boolean
  turnThinking?: boolean
  agentWorking?: boolean
  canStop?: boolean
  ask?: Parameters<typeof MobileNativeChatView>[0]['ask']
  question?: Parameters<typeof MobileNativeChatView>[0]['question']
  permission?: Parameters<typeof MobileNativeChatView>[0]['permission']
  sendSurfaceId?: string
  spinner?: { verb: string; elapsed: string | null; thinking: string | null } | null
}

function chatViewElement(overrides: Overrides): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages: [],
    folded: [],
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn(),
    ...overrides
  })
}

/** One background shell still running, as Claude Code 2.x writes it; the
 *  launch result is verbatim apart from the shortened output path. */
const RUNNING_SHELL: NativeChatMessage[] = [
  {
    id: 'a1',
    role: 'assistant',
    timestamp: 1_000,
    source: 'transcript',
    blocks: [
      {
        type: 'tool-call',
        name: 'Bash',
        input: { command: 'pnpm build', description: 'Build the APK', run_in_background: true }
      }
    ]
  },
  {
    id: 'r1',
    role: 'user',
    timestamp: 1_100,
    source: 'transcript',
    blocks: [
      {
        type: 'tool-result',
        output:
          'Command running in background with ID: bpz1skord. Output is being written to: /private/tmp/tasks/bpz1skord.output. You will be notified when it completes.'
      }
    ]
  }
]

/** The texts on the line above the composer, in order; null when none. */
function statusLine(instance: ReturnType<typeof create>): string[] | null {
  const line = instance.root.findAll((node) => node.props?.testID === 'native-chat-status-line')[0]
  if (!line) {
    return null
  }
  return line
    .findAllByType('Text')
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string')
}

describe('the status line above the composer, as the Claude app draws it', () => {
  let instance: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => instance?.unmount())
    instance = null
  })
  async function show(overrides: Overrides): Promise<ReturnType<typeof create>> {
    await act(async () => {
      instance = create(chatViewElement(overrides))
    })
    return instance!
  }

  it('says the agent\'s own verb and the running-task count on one line', async () => {
    const view = await show({
      messages: RUNNING_SHELL,
      folded: [],
      agentWorking: true,
      spinner: { verb: 'Cooking', elapsed: null, thinking: null }
    })
    expect(statusLine(view)).toEqual(['Cooking…', ' · ', '1 running task'])
    expect(view.root.findAll((node) => node.type === 'WorkingIndicator')).toHaveLength(0)
  })

  it('shows the time and the thinking status once the agent\'s own line does', async () => {
    const view = await show({
      messages: RUNNING_SHELL,
      folded: [],
      agentWorking: true,
      spinner: { verb: 'Cooking', elapsed: '1m 16s', thinking: 'thinking some more' }
    })
    expect(statusLine(view)).toEqual(['1m 16s', ' · ', '1 running task', ' · thinking some more…'])
  })

  it('says Working when no spinner has been read', async () => {
    const view = await show({ agentWorking: true })
    expect(statusLine(view)).toEqual(['Working…'])
  })

  it('keeps the count there after the turn ends, counted from the unfiltered transcript', async () => {
    // `folded` drops the harness turns; the count must come off `messages`.
    const view = await show({ messages: RUNNING_SHELL, folded: [], agentWorking: false })
    expect(statusLine(view)).toEqual(['1 running task'])
  })

  it('draws nothing there when the agent is idle with nothing running', async () => {
    const view = await show({ agentWorking: false })
    expect(statusLine(view)).toBeNull()
  })

  it('opens the background tasks sheet from the count', async () => {
    const view = await show({ messages: RUNNING_SHELL, folded: [], agentWorking: false })
    const sheet = () => view.root.findAll((node) => node.type === 'BackgroundTasksSheet')[0]!
    expect(sheet().props.visible).toBe(false)
    const count = view.root.findAll(
      (node) =>
        node.type === 'Pressable' &&
        node.props.accessibilityLabel === '1 running task. Open background tasks'
    )[0]!
    await act(async () => count.props.onPress())
    expect(sheet().props.visible).toBe(true)
  })

  it('no longer draws the count a second time under the last message', async () => {
    const view = await show({ messages: RUNNING_SHELL, folded: [], agentWorking: false })
    const header = view.root.findByType('FlashList').props.ListHeaderComponent
    let rendered!: ReturnType<typeof create>
    act(() => {
      rendered = create(header)
    })
    expect(rendered.root.findAll((node) => node.props?.runningCount !== undefined)).toHaveLength(0)
    act(() => rendered.unmount())
  })
})
