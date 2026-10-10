import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { MobileNativeChatView } from './MobileNativeChatView'
import { REASONING_FOLD_CHARS, reasoningOpening } from './MobileNativeChatReasoningNote'

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
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  Square: 'Square',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
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

  /** Taps whatever button holds this label. */
  function press(label: string): void {
    const text = renderer!.root.find((node) => node.type === ('Text' as never) && node.props.children === label)
    let at: ReactTestInstance | null = text.parent
    while (at && typeof at.props.onPress !== 'function') {
      at = at.parent
    }
    at!.props.onPress()
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

  // The Claude app draws Claude's thinking as its text beside a thin, faint
  // line. On the phone thinking is a `reasoning` message: the structured lane,
  // Codex and Grok send one today. A terminal Claude tab does not yet, because
  // Orca's transcript reader gives a `thinking` block the `assistant` role
  // (docs/claude-app-parity.md item 1); this is the row that draws it the day
  // that role arrives.
  it.each(SCHEMES)('draws a thought as its text beside the thin line, in %s', async (scheme, colors) => {
    await drawTurn(
      scheme,
      [user('u1'), thought('r1', 'Weighing whether to edit in place.'), ...work('t1', 'Edit'), prose('a1', 'Edited.')],
      false
    )
    expect(Object.fromEntries(wordsOnScreen())).toEqual({
      'Weighing whether to edit in place.': { width: 2, color: colors.border },
      'Edited.': null
    })
  })

  it.each(SCHEMES)('draws a turn of one note, and nothing else, with no line, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), prose('a1', 'Only this.')], false)
    expect([...wordsOnScreen()]).toEqual([['Only this.', null]])
  })

  it.each(SCHEMES)('draws a turn of one thought, and nothing else, beside the line, in %s', async (scheme, colors) => {
    await drawTurn(scheme, [user('u1'), thought('r1', 'Only thinking.')], true)
    expect([...wordsOnScreen()]).toEqual([['Only thinking.', { width: 2, color: colors.border }]])
  })

  it.each(SCHEMES)('draws no line anywhere in a turn with no words at all, in %s', async (scheme) => {
    await drawTurn(scheme, [user('u1'), ...work('t1', 'Bash'), ...work('t2', 'Read')], true)
    expect(wordsOnScreen().size).toBe(0)
    const railed = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && Number(flatStyle(node).borderLeftWidth ?? 0) > 0
    )
    expect(railed).toHaveLength(0)
  })

  // A thought is drawn whole, so a long think-aloud needs a fold of its own
  // or it swamps the transcript again (#17579). No thinking block with text in
  // this machine's Claude Code 2.1.282 transcripts passed 414 characters
  // (2026-09-26); a Codex or Grok reasoning run can.
  it.each(SCHEMES)('keeps a long thought to its opening until Show more, in %s', async (scheme, colors) => {
    const long = `${'Tracing the relay reconnect path. '.repeat(20)}\n\nThe second stretch nobody sees folded.`
    await drawTurn(scheme, [user('u1'), thought('r1', long), prose('a1', 'Fixed.')], false)
    const folded = [...wordsOnScreen()].find(([words]) => words.startsWith('Tracing'))
    expect(folded?.[1]).toEqual({ width: 2, color: colors.border })
    expect(folded?.[0].length).toBeLessThanOrEqual(REASONING_FOLD_CHARS + 1)
    expect(folded?.[0]).not.toContain('second stretch')
    await act(async () => press('Show more'))
    expect([...wordsOnScreen().keys()]).toContain(long)
    await act(async () => press('Show less'))
    expect([...wordsOnScreen().keys()]).not.toContain(long)
    expect(folded?.[0]).toBe(reasoningOpening(long))
  })

  // Review, 2026-09-26: Codex's structured lane streams a summary into one
  // row. A cut at a paragraph break took a thought read at 600 characters down
  // to its first paragraph at 601, two-thirds of it gone mid-read.
  it.each(SCHEMES)('keeps what a thought already showed when it streams past the fold, in %s', async (scheme) => {
    const grown = `${'Reading the reconnect path. '.repeat(8)}\n\n${'Then the supervisor backoff. '.repeat(40)}`
    const drawn = async (length: number): Promise<string> => {
      await drawTurn(scheme, [user('u1'), thought('r1', grown.slice(0, length))], true)
      return [...wordsOnScreen().keys()][0] ?? ''
    }
    const whole = await drawn(REASONING_FOLD_CHARS)
    const cut = await drawn(REASONING_FOLD_CHARS + 1)
    expect(whole).toBe(grown.slice(0, REASONING_FOLD_CHARS).trim())
    expect(whole.startsWith(cut.replace(/…$/, ''))).toBe(true)
    // At most the word the stream was in the middle of.
    expect(whole.length - cut.length).toBeLessThan(40)
    expect(await drawn(900)).toBe(cut)
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

describe('where a long thought is cut', () => {
  it('leaves a thought of exactly the fold length whole, and cuts one character more', () => {
    const edge = 'a'.repeat(REASONING_FOLD_CHARS - 6) + ' words'
    expect(edge).toHaveLength(REASONING_FOLD_CHARS)
    expect(reasoningOpening(edge)).toBeNull()
    expect(reasoningOpening(`${edge}.`)).toBe(`${'a'.repeat(REASONING_FOLD_CHARS - 6)}…`)
  })

  it('cuts at the last word before the fold, not back at an earlier paragraph break', () => {
    const text = `${'First paragraph. '.repeat(15)}\n\n${'Second paragraph. '.repeat(30)}`
    const opening = reasoningOpening(text)!
    expect(opening).toContain('Second paragraph.')
    expect(opening.length).toBeLessThanOrEqual(REASONING_FOLD_CHARS + 1)
    expect(opening.endsWith('…')).toBe(true)
    expect(text.startsWith(opening.slice(0, -1))).toBe(true)
  })

  // Review, 2026-09-26: an emoji across the fold in a thought with no space
  // before it (a long path, CJK) kept half of it, drawn as a replacement glyph.
  it('never cuts an emoji in half', () => {
    const opening = reasoningOpening(`${'x'.repeat(REASONING_FOLD_CHARS - 1)}😀${'y'.repeat(10)}`)
    expect(opening).toBe(`${'x'.repeat(REASONING_FOLD_CHARS - 1)}…`)
  })

  // Review, 2026-09-26: a cut inside a fenced block left the fence open, so
  // the markdown drew the rest of the opening as code.
  it('closes a code block the cut left open', () => {
    const fence = '`'.repeat(3)
    const code = 'const value = compute(input)\n'.repeat(40)
    const opening = reasoningOpening(`Checking the call.\n\n${fence}ts\n${code}${fence}\nDone.`)!
    expect(opening.split('\n').filter((line) => line.startsWith(fence))).toHaveLength(2)
    expect(opening.endsWith(`\n${fence}`)).toBe(true)
  })

  it('cuts a thought with no space in it at the fold length, never past it', () => {
    const opening = reasoningOpening('x'.repeat(REASONING_FOLD_CHARS * 2))
    expect(opening).toBe(`${'x'.repeat(REASONING_FOLD_CHARS)}…`)
  })

  it('leaves an empty thought whole', () => {
    expect(reasoningOpening('')).toBeNull()
  })
})
