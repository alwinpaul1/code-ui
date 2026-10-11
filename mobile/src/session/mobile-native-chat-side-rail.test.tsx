import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { MobileNativeChatView } from './MobileNativeChatView'

// The whole chain, list to row: the view decides what each row is told, the
// real row decides what it draws, and the line down the left edge is the
// product of both. The view's own suite stubs the row, so it cannot see it.
vi.mock('@shopify/flash-list', async () => {
  const React = await import('react')
  return {
    FlashList: ({
      data,
      renderItem
    }: {
      data: NativeChatMessage[]
      renderItem: (info: { item: NativeChatMessage; index: number }) => ReactNode
    }) =>
      React.createElement(
        'FlashList',
        null,
        data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index })))
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
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
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

function user(id: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: 0, source: 'transcript' }
}
function prose(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}
function thought(id: string, text: string): NativeChatMessage {
  return { id, role: 'reasoning', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}
/** A tool call, then its result: the two records Claude Code writes, which
 *  the phone's fold hangs off the message before them. */
function work(id: string, name: string): NativeChatMessage[] {
  return [
    { id: `${id}-call`, role: 'assistant', blocks: [{ type: 'tool-call', name, input: {} }], timestamp: 0, source: 'transcript' },
    { id: `${id}-result`, role: 'tool', blocks: [{ type: 'tool-result', output: 'ok' }], timestamp: 0, source: 'transcript' }
  ]
}

type Scheme = 'light' | 'dark'
const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(node.props.style).flat(Infinity).filter(Boolean))
}

/** The line down the left edge of whatever holds this node, if any. */
function railBeside(node: ReactTestInstance): { width: number; color: unknown } | null {
  for (let at: ReactTestInstance | null = node.parent; at; at = at.parent) {
    if (typeof at.type !== 'string') {
      continue
    }
    const style = flatStyle(at)
    if (typeof style.borderLeftWidth === 'number' && style.borderLeftWidth > 0) {
      return { width: style.borderLeftWidth, color: style.borderLeftColor }
    }
  }
  return null
}

describe('the line down the left edge of a turn', () => {
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

  async function drawTurn(scheme: Scheme, records: NativeChatMessage[], agentWorking: boolean): Promise<void> {
    const folded = foldMobileNativeChatMessages(records)
    await act(async () => {
      const screen = (
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatView
            messages={records}
            folded={folded}
            status="ready"
            streaming={null}
            onSend={vi.fn().mockResolvedValue(true)}
            sendSurfaceId="tab-a"
            getSendCompletionGeneration={() => 0}
            getComposerEditGeneration={() => 0}
            pending={[]}
            composerText=""
            onComposerTextChange={vi.fn()}
            agentWorking={agentWorking}
          />
        </ThemeProvider>
      )
      // A second draw is the same list growing, as a streamed row does.
      if (renderer) {
        renderer.update(screen)
      } else {
        renderer = create(screen)
      }
    })
  }

  /** Every run of the agent's words on screen, and the line beside it. */
  function wordsOnScreen(): Map<string, { width: number; color: unknown } | null> {
    const words = new Map<string, { width: number; color: unknown } | null>()
    for (const node of renderer!.root.findAll((candidate) => candidate.type === ('MobileMarkdown' as never))) {
      words.set(String(node.props.content), railBeside(node))
    }
    return words
  }

  // 2026-09-25, the same session side by side (Claude Code 2.1.282): the
  // Claude app drew none of a running turn's prose beside a line, and Code UI
  // drew it beside every note but the newest, so nearly the whole reply had one.
  it.each(SCHEMES)(
    'draws no line beside any note of a running turn whose words all sit before tool calls, in %s',
    async (scheme) => {
      await drawTurn(
        scheme,
        [
          user('u1'),
          prose('a1', 'Checking which files are tracked.'),
          ...work('t1', 'Bash'),
          prose('a2', 'Updating the three tracked files.'),
          ...work('t2', 'Edit'),
          prose('a3', 'Running the checks again.'),
          ...work('t3', 'Bash')
        ],
        true
      )
      expect(Object.fromEntries(wordsOnScreen())).toEqual({
        'Checking which files are tracked.': null,
        'Updating the three tracked files.': null,
        'Running the checks again.': null
      })
    }
  )

  it.each(SCHEMES)('draws no line beside the answer that closes a turn, in %s', async (scheme) => {
    await drawTurn(
      scheme,
      [user('u1'), prose('a1', 'Looking first.'), ...work('t1', 'Read'), prose('a2', 'Job 2990 is done.')],
      false
    )
    expect(Object.fromEntries(wordsOnScreen())).toEqual({ 'Looking first.': null, 'Job 2990 is done.': null })
  })

  // The Claude app 1.261009.20 never draws thinking inline: a thought is a
  // "Thought process" row that opens a sheet (2026-10-12). Until then ours drew
  // the words beside a thin line. On the phone thinking is a `reasoning`
  // message: the structured lane, Codex and Grok send one; a terminal Claude
  // tab does not, because Orca's reader gives a `thinking` block the
  // `assistant` role (docs/claude-app-parity.md item 1).
  it.each(SCHEMES)('draws a thought as its "Thought process" row, with no words and no line, in %s', async (scheme) => {
    await drawTurn(
      scheme,
      [user('u1'), thought('r1', 'Weighing whether to edit in place.'), ...work('t1', 'Edit'), prose('a1', 'Edited.')],
      false
    )
    expect(Object.fromEntries(wordsOnScreen())).toEqual({ 'Edited.': null })
    expect(renderer!.root.findAll((node) => node.type === ('Text' as never) && node.props.children === 'Thought process')).toHaveLength(1)
  })

  it.each(SCHEMES)('draws a turn of one note, and nothing else, with no line, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), prose('a1', 'Only this.')], false)
    expect([...wordsOnScreen()]).toEqual([['Only this.', null]])
  })

  it.each(SCHEMES)('draws a turn of one thought as its row alone, with no line, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), thought('r1', 'Only thinking.')], true)
    expect(wordsOnScreen().size).toBe(0)
    expect(renderer!.root.findAll((node) => node.type === ('Text' as never) && node.props.children === 'Thought process')).toHaveLength(1)
  })

  it.each(SCHEMES)('draws no line anywhere in a turn with no words at all, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), ...work('t1', 'Bash'), ...work('t2', 'Read')], true)
    expect(wordsOnScreen().size).toBe(0)
    const railed = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && Number(flatStyle(node).borderLeftWidth ?? 0) > 0
    )
    expect(railed).toHaveLength(0)
  })

  it.each(SCHEMES)('draws no line with nothing beside it for an empty thought, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), thought('r1', '  \n '), prose('a1', 'Done.')], false)
    expect(Object.fromEntries(wordsOnScreen())).toEqual({ 'Done.': null })
    const railed = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && Number(flatStyle(node).borderLeftWidth ?? 0) > 0
    )
    expect(railed).toHaveLength(0)
  })
})
