import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
// The system interrupting a touch is not what these tests are about; see
// use-mobile-native-chat-tail-follow.selection.test.ts for that.
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
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  // The list sizes its render-ahead window from the screen, so the stub has to
  // report one — a Galaxy S23's 2316px at density 2.8125.
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))

// The list draws its header, where the working line lives as the transcript's last row; the
// rows themselves are not needed here.
vi.mock('@shopify/flash-list', async () => {
  const React = await import('react')
  return {
    FlashList: (props: { ListHeaderComponent?: unknown }) =>
      React.createElement('FlashList', props, props.ListHeaderComponent as never)
  }
})

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
    Gesture: { Simultaneous: () => ({}), Native: () => { const native: Record<string, () => unknown> = { shouldCancelWhenOutside: () => native, runOnJS: () => native, onFinalize: () => native }; return native }, Pinch: () => chain },
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
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: 'ShellOutputSheet' }))
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
    getComposerEditGeneration: () => 0,
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
  // Each square separator (ClaudeFooterSeparator) reads as the " · " it draws.
  return line
    .findAll((node) => (node.type as unknown) === 'Text' || (node.props.testID === 'claude-footer-separator' && (node.type as unknown) === 'View'))
    .map((node) => (node.props.testID === 'claude-footer-separator' ? ' · ' : node.props.children))
    .filter((child): child is string => typeof child === 'string')
}

describe('the working footer at the transcript\'s foot, as the Claude app draws it', () => {
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

  it('shows the Claude working mark and the running-task count on one line, and never the word Working', async () => {
    const view = await show({
      messages: RUNNING_SHELL,
      folded: [],
      agentWorking: true,
      spinner: { verb: 'Cooking', elapsed: null, thinking: null }
    })
    expect(statusLine(view)!.join('')).toMatch(/^[A-Za-z]+\.\.\. · 1 running task$/)
    expect(statusLine(view)).not.toContain('Working')
    expect(view.root.findAll((node) => node.props?.testID === 'claude-working-mark').length).toBeGreaterThan(0)
    expect(view.root.findAll((node) => String(node.type) === 'WorkingIndicator')).toHaveLength(0)
  })

  // The user asked for words, not the spinner's time (2026-09-25); the Claude app's line has the
  // verb it picks itself and no thinking status (2026-10-15).
  it('does not repeat the agent\'s own time or thinking status beside the count', async () => {
    const view = await show({
      messages: RUNNING_SHELL,
      folded: [],
      agentWorking: true,
      spinner: { verb: 'Cooking', elapsed: '1m 16s', thinking: 'thinking some more' }
    })
    expect(statusLine(view)!.join(' ')).not.toMatch(/thinking|1m 16s/)
  })

  it('shows the spinner and a verb when no spinner has been read and no task runs', async () => {
    const view = await show({ agentWorking: true })
    expect(statusLine(view)).toHaveLength(1)
    expect(statusLine(view)![0]).toMatch(/^[A-Za-z]+\.\.\.$/)
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
    const sheet = () => view.root.findAll((node) => String(node.type) === 'BackgroundTasksSheet')[0]!
    expect(sheet().props.visible).toBe(false)
    const count = view.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        node.props.accessibilityLabel === '1 running task. Open background tasks'
    )[0]!
    await act(async () => count.props.onPress())
    expect(sheet().props.visible).toBe(true)
  })

  it('draws the count once, not a second time under the last message', async () => {
    const view = await show({ messages: RUNNING_SHELL, folded: [], agentWorking: false })
    const counts = view.root.findAll(
      (node) => String(node.type) === 'Text' && node.props.children === '1 running task'
    )
    expect(counts).toHaveLength(1)
  })

  // The user's phone, 0.9.154 (2026-10-15): scrolled up, the blue "4 running tasks" was drawn ON
  // the assistant's prose ("backgro|4 running tasks|und skill row"), because the line was pinned
  // in the see-through dock above the composer. In the Claude app it is the list's last item
  // (`y07` "thinking_spark"), so it scrolls with the messages and cannot overlap one.
  it('draws the working line as the transcript\'s last row, so it scrolls with the messages and never lies over them', async () => {
    const view = await show({ messages: RUNNING_SHELL, folded: [], agentWorking: true })
    const dock = view.root.findAll((node) => node.props?.testID === 'native-chat-dock' && String(node.type) === 'View')[0]!
    expect(dock.findAll((node) => node.props?.testID === 'native-chat-status-line')).toHaveLength(0)
    const list = view.root.findByType('FlashList' as never)
    expect(list.findAll((node) => node.props?.testID === 'native-chat-status-line')).toHaveLength(1)
    // Below the newest message and above the room kept for the composer, as in the app.
    const header = list.props.ListHeaderComponent as { props: { children: unknown[] } }
    const order = (header.props.children as ({ type?: { name?: string }; props?: { testID?: string } } | null)[]).map(
      (child) => child?.props?.testID ?? child?.type?.name ?? null
    )
    expect(order.indexOf('MobileNativeChatWorkingFooter')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('MobileNativeChatWorkingFooter')).toBeLessThan(order.indexOf('native-chat-dock-spacer'))
  })

  it('keeps the working line in the list when the session has no messages yet, and draws nothing there when idle', async () => {
    const working = await show({ agentWorking: true })
    expect(working.root.findByType('FlashList' as never).findAll((node) => node.props?.testID === 'native-chat-status-line')).toHaveLength(1)
    act(() => working.unmount())
    instance = null
    const idle = await show({ agentWorking: false })
    expect(idle.root.findAll((node) => node.props?.testID === 'native-chat-status-line')).toHaveLength(0)
  })
})
