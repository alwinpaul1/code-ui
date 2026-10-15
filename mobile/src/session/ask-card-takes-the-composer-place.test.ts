import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'

// Reported 2026-10-16 from a screenshot beside the Claude app's: while the app's
// question card is up, no composer is drawn under it; the card takes the
// composer's place at the bottom of the screen. Ours drew the card AND a
// "Queue a message..." composer below it, which pushed the card up and cut its
// last option off under the footer.

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
// The system interrupting a touch is not what these tests are about; see
// use-mobile-native-chat-tail-follow.settle.test.ts for that.
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: 'ShellOutputSheet' }))
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
      canStop?: boolean
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

const ASK: AskPrompt = {
  questions: [
    {
      question: 'Which library should we use?',
      multiSelect: false,
      options: [{ label: 'date-fns' }, { label: 'luxon' }]
    }
  ]
} as AskPrompt

const turn: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  timestamp: 0,
  source: 'transcript',
  blocks: [{ type: 'text', text: 'Let me ask.' }]
}

describe('the ask card in the dock', () => {
  let renderer: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(extra: Partial<Parameters<typeof MobileNativeChatView>[0]>): Promise<void> {
    const messages = [turn]
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

  const count = (type: string): number => renderer!.root.findAll((node) => String(node.type) === type).length

  it('hides the composer while an unanswered question card is up', async () => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: true })
    expect(count('ChatAsk')).toBe(1)
    expect(count('Composer')).toBe(0)
  })

  it('brings the composer back once the answer is sent', async () => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: true, askSentAt: 1 })
    expect(count('ChatAsk')).toBe(1)
    expect(count('Composer')).toBe(1)
  })

  it('keeps the composer when no question is up', async () => {
    await render({})
    expect(count('ChatAsk')).toBe(0)
    expect(count('Composer')).toBe(1)
  })

  // Review of f00febd4a: the transcript's copy of a question is not gated on the
  // agent waiting (use-mobile-native-chat-prompts.ts), so it can be stale. Hiding
  // the composer under it took Stop away from a working agent, with Skip's
  // Escape the only key left on screen.
  it('keeps the composer and its Stop under a question only the transcript shows', async () => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: false, canStop: true })
    expect(count('ChatAsk')).toBe(1)
    expect(count('Composer')).toBe(1)
    const composer = renderer!.root.find((node) => String(node.type) === 'Composer')
    expect(composer.props.canStop).toBe(true)
  })

  // Neither an Escape (it would interrupt the turn) nor a dismissal: the
  // transcript can run ahead of the hook row, and a dismissal keyed on the
  // question would keep the card hidden once the row flips to waiting on it
  // (second review of this fix). The card says why instead.
  it('writes no Escape and hides nothing when a question only the transcript shows is declined while the agent works', async () => {
    const onCancelAsk = vi.fn().mockResolvedValue(true)
    const onDismissAsk = vi.fn()
    await render({ ask: ASK, askKey: 'ask-1', askLive: false, onCancelAsk, onDismissAsk })
    const card = renderer!.root.find((node) => String(node.type) === 'ChatAsk')
    expect(card.props.declineRefusal).toEqual(expect.stringContaining('working'))
    let declined: boolean | undefined
    await act(async () => {
      declined = await card.props.onCancel()
    })
    expect(declined).toBe(false)
    expect(onCancelAsk).not.toHaveBeenCalled()
    expect(onDismissAsk).not.toHaveBeenCalled()
  })

  it('still writes Escape to decline a question the agent is waiting on', async () => {
    const onCancelAsk = vi.fn().mockResolvedValue(true)
    await render({ ask: ASK, askKey: 'ask-1', askLive: true, onCancelAsk, onDismissAsk: vi.fn() })
    const card = renderer!.root.find((node) => String(node.type) === 'ChatAsk')
    expect(card.props.declineRefusal ?? null).toBeNull()
    await act(async () => {
      await card.props.onCancel()
    })
    expect(onCancelAsk).toHaveBeenCalledTimes(1)
  })

  // Review of f00febd4a: the recording row lives in the composer, so a question
  // arriving mid-dictation unmounted it and left the mic on with no control.
  it.each([
    ['recording', { micActive: true }],
    ['transcribing', { micTranscribing: true }]
  ] as const)('keeps the composer while dictation is %s when a question arrives', async (_state, mic) => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: true, ...mic })
    expect(count('ChatAsk')).toBe(1)
    expect(count('Composer')).toBe(1)
  })

  it('tells the question card how much of the window the keyboard takes', async () => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: true, keyboardInset: 330 })
    const card = renderer!.root.find((node) => String(node.type) === 'ChatAsk')
    expect(card.props.keyboardInset).toBe(330)
    expect(card.props.besideComposer).toBe(false)
  })

  it('tells the question card when the composer is still drawn under it', async () => {
    await render({ ask: ASK, askKey: 'ask-1', askLive: false })
    const card = renderer!.root.find((node) => String(node.type) === 'ChatAsk')
    expect(card.props.besideComposer).toBe(true)
  })
})

describe('the pins the question card must not move', () => {
  let renderer: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(extra: Partial<Parameters<typeof MobileNativeChatView>[0]>): Promise<void> {
    const messages = [turn]
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
          canStop: true,
          ...extra
        })
      )
    })
  }
  const composers = () => renderer!.root.findAll((node) => String(node.type) === 'Composer')

  it('keeps Stop on screen under a permission prompt', async () => {
    await render({ permission: { title: 'Allow Bash?', options: [{ label: 'Yes', send: '1' }] } })
    expect(renderer!.root.findAll((node) => String(node.type) === 'ChatPermission')).toHaveLength(1)
    expect(composers()).toHaveLength(1)
    expect(composers()[0]!.props.canStop).toBe(true)
  })

  it('keeps the structured lane’s composer, where the controller hands the view no ask', async () => {
    await render({ structuredActivityUi: true, ask: null, askLive: false })
    expect(composers()).toHaveLength(1)
  })
})
