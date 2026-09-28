import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { SEND_MESSAGE_BY_ID_2026_09_26 } from './fixtures/claude-send-message-2026-09-26'

const mocks = vi.hoisted(() => ({
  reduced: false,
  loop: vi.fn((animation: unknown) => animation)
}))

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: mocks.loop,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  // Android 14, the user's S23: a running row's shimmer asks (MobileNativeChatShimmerText).
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Circle: 'Circle',
  CircleCheck: 'CircleCheck',
  CircleDot: 'CircleDot',
  ListChecks: 'ListChecks',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
// The detail sheet pulls in gesture-handler/reanimated (via DraggableDetailSheet),
// which Node cannot parse; the run's own tests never open it.
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
// The run's tests are about the run; the OS setting is stubbed to an answer
// so the render stays synchronous.
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))

// Two names that each carry the character a joined summary uses to separate
// members. Upstream #19372: `browser.open · tools/read` is unreadable as two
// calls, because the punctuation inside a name looks exactly like the one
// between names.
const PUNCTUATED_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'browser.open', input: { url: 'https://example.com' } },
  { type: 'tool-call', name: 'tools/read', input: { file_path: 'README.md' } }
]

const LONG_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
  { type: 'tool-call', name: 'Edit', input: { file_path: 'b.ts' } },
  { type: 'tool-call', name: 'Write', input: { file_path: 'c.ts' } },
  { type: 'tool-call', name: 'Read', input: { file_path: 'd.ts' } }
]

// docs/claude-app-parity.md item 3: the screenshot's own shape — two plain
// commands and a Write the result is certain created a new file.
const RAN_2_COMMANDS_CREATED_FILE: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'a' } },
  { type: 'tool-result', output: '' },
  { type: 'tool-call', name: 'Bash', input: { command: 'b' } },
  { type: 'tool-result', output: '' },
  { type: 'tool-call', name: 'Write', input: { file_path: '/repo/NEW.md', content: 'x\ny\n' } },
  { type: 'tool-result', output: 'File created successfully at: /repo/NEW.md' }
]

const COMMAND_ONLY_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
  { type: 'tool-result', output: '' }
]

function Harness({
  blocks,
  activeTurnIsWorking,
  defaultExpanded = false,
  expandChildren,
  focusView
}: {
  blocks: NativeChatBlock[]
  activeTurnIsWorking?: boolean
  defaultExpanded?: boolean
  expandChildren?: boolean
  focusView?: boolean
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    defaultExpanded,
    expandChildren,
    focusView,
    activeCall:
      activeTurnIsWorking === undefined
        ? null
        : selectActiveToolCall(blocks, { activeTurnIsWorking }),
    styles
  })
}

type Rendered = { members: { name: string; color: string | undefined }[]; texts: string[] }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    if (typeof node.props.children === 'string') {
      texts.push(node.props.children)
    }
  }
  const members = renderer.root
    .findAll((node) => node.props?.testID === 'tool-run-member-name')
    .map((node) => ({
      name: String(node.props.children),
      color: flattenColor(node.props.style)
    }))
  return { members, texts }
}

// A Text's whole string, nested spans included.
function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  return node.children.map((child) => textOf(child)).join('')
}

function flattenColor(style: unknown): string | undefined {
  const entries = Array.isArray(style) ? style : [style]
  for (const entry of entries) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { color?: unknown }).color === 'string'
    ) {
      return (entry as { color: string }).color
    }
  }
  return undefined
}

describe('a batch of tool calls in one run header', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(blocks: NativeChatBlock[], scheme: 'light' | 'dark' = 'light'): Rendered {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(Harness, { blocks })
        )
      )
    })
    return readTree(renderer!)
  }

  // 2026-09-12: the fold reads as the Claude app writes it — one sentence
  // about what the tools did, not the agent's tool names and arguments.
  it('reads as one sentence about what the tools did', () => {
    expect(render(LONG_RUN).texts).toContain('Ran a command, read 2 files, edited 2 files')
  })

  it('does not name a tool or its argument in the collapsed row', () => {
    const { texts } = render(PUNCTUATED_RUN)
    expect(texts.join(' ')).not.toContain('browser.open')
    // A single read names the file, the way the Claude app's row does.
    // `browser.open` still has no plain-English verb, so it stays "a tool".
    expect(texts).toContain('Used a tool, read README.md')
  })

  it('falls back to a plain call count when no call has a name', () => {
    const nameless: NativeChatBlock[] = [{ type: 'tool-call', name: '', input: {} }]
    expect(render(nameless).texts).toContain('Used a tool')
  })

  // Orca #21151. A run whose call failed used to read exactly like a clean one
  // once collapsed; the failure was only findable by expanding it. The
  // sentence says "(N failed)" itself, the way the Claude app's row does, and
  // a second right-aligned "N failed" said it twice and cut the sentence
  // (2026-09-26 screenshot). Counted over every call.
  it.each(['light', 'dark'] as const)(
    'says how many calls failed once, in the sentence, in %s',
    (scheme) => {
      const mixed: NativeChatBlock[] = [
        { type: 'tool-call', name: 'shell', input: { command: 'a' }, state: 'failed' },
        { type: 'tool-result', output: 'exit 1', isError: true },
        { type: 'tool-call', name: 'shell', input: { command: 'b' }, state: 'failed' },
        { type: 'tool-result', output: 'exit 2', isError: true },
        { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' }, state: 'completed' },
        { type: 'tool-result', output: 'ok' }
      ]
      const { texts } = render(mixed, scheme)
      expect(texts).toContain('Ran 2 commands (2 failed), read a.ts')
      expect(texts).not.toContain('2 failed')
      expect(renderer!.root.findAllByProps({ testID: 'tool-run-failed-count' })).toHaveLength(0)
    }
  )

  it('counts an error result on a lane that writes no lifecycle state, once per call', () => {
    const legacy: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Bash', input: { command: 'a' } },
      { type: 'tool-result', output: 'exit 1', isError: true }
    ]
    const { texts } = render(legacy)
    expect(texts).toContain('Ran a command (1 failed)')
    expect(texts).not.toContain('1 failed')
  })

  // The label stays where nothing else on the row says a call failed: focus
  // view's bare count, and a failure known only from the call's own `failed`
  // state, which the sentence (counting error results) does not state.
  it.each(['light', 'dark'] as const)(
    'keeps the muted "N failed" label where the row states the failure nowhere else, in %s',
    (scheme) => {
      const palette = scheme === 'dark' ? darkColors : lightColors
      const failing: NativeChatBlock[] = [
        { type: 'tool-call', name: 'Bash', input: { command: 'a' } },
        { type: 'tool-result', output: 'exit 1', isError: true },
        { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool-result', output: 'ok' }
      ]
      act(() => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(Harness, { blocks: failing, focusView: true })
          )
        )
      })
      const focus = readTree(renderer!).texts
      expect(focus).toContain('2 tool calls')
      expect(focus).toContain('1 failed')
      const mark = renderer!.root.findByProps({ testID: 'tool-run-failed-count' })
      expect(mark.props.accessibilityLabel).toBe('Failed tool calls: 1')
      expect(flattenColor(mark.props.style)).toBe(palette.textMuted)
      act(() => renderer!.unmount())

      const stateOnly: NativeChatBlock[] = [
        { type: 'tool-call', name: 'shell', input: { command: 'a' }, state: 'failed' }
      ]
      const { texts } = render(stateOnly, scheme)
      expect(texts).toContain('Ran a command')
      expect(texts).toContain('1 failed')
    }
  )

  // Review of c714c9bc: "(N failed)" ends the one-line sentence, and a phone
  // row shows about 50 characters of it. A failed SendMessage's sentence
  // carries its message preview before the count; a described command its
  // description. With the label withheld the row read as a clean run behind
  // its ellipsis, the silence #21151 was ported to end.
  it.each(['light', 'dark'] as const)(
    'still says a SendMessage failed when its preview pushes "(1 failed)" past the ellipsis, in %s',
    (scheme) => {
      const failedSend: NativeChatBlock[] = [
        SEND_MESSAGE_BY_ID_2026_09_26.call!,
        { type: 'tool-result', output: 'No agent named a07ea6f616a8e32a1', isError: true }
      ]
      render(failedSend, scheme)
      const sentence = textOf(renderer!.root.findByProps({ testID: 'tool-run-sentence' }))
      expect(sentence.startsWith('Messaged @a07ea6f616a8e32a1 Agreed.')).toBe(true)
      expect(sentence.indexOf('(1 failed)')).toBeGreaterThan(50)
      const mark = renderer!.root.findByProps({ testID: 'tool-run-failed-count' })
      expect(mark.props.children).toBe('1 failed')
      expect(flattenColor(mark.props.style)).toBe((scheme === 'dark' ? darkColors : lightColors).textMuted)
    }
  )

  it.each(['light', 'dark'] as const)(
    'still says a described command failed when its description pushes "(1 failed)" past the ellipsis, in %s',
    (scheme) => {
      const failedBash: NativeChatBlock[] = [
        {
          type: 'tool-call',
          name: 'Bash',
          input: {
            command: 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint',
            description: 'Run the mobile regression gate: typecheck, vitest, oxlint, ratchet'
          }
        },
        { type: 'tool-result', output: 'exit 1', isError: true }
      ]
      const { texts } = render(failedBash, scheme)
      expect(texts).toContain('Ran Run the mobile regression gate: typecheck, vitest, oxlint, ratchet (1 failed)')
      const mark = renderer!.root.findByProps({ testID: 'tool-run-failed-count' })
      expect(mark.props.children).toBe('1 failed')
      expect(flattenColor(mark.props.style)).toBe((scheme === 'dark' ? darkColors : lightColors).textMuted)
    }
  )

  // Review of a91c04d1: "Messaged @team lead Look at the parser." has no
  // visible boundary between a spaced name and the preview. The recipient is
  // its own span in the row's member-name tone, the mark a batch row already
  // uses between a name and its argument.
  it.each(['light', 'dark'] as const)(
    'marks where a spaced recipient ends and the message preview begins, in %s',
    (scheme) => {
      const palette = scheme === 'dark' ? darkColors : lightColors
      render(
        [
          { type: 'tool-call', name: 'SendMessage', input: { to: 'team lead', message: 'Look at the parser.' } },
          { type: 'tool-result', output: '{"success":true}' }
        ],
        scheme
      )
      const sentence = renderer!.root.findByProps({ testID: 'tool-run-sentence' })
      expect(textOf(sentence)).toBe('Messaged @team lead Look at the parser.')
      const recipient = sentence.findAll(
        (node) => typeof node.type === 'string' && node !== sentence && node.props.children === '@team lead'
      )
      expect(recipient).toHaveLength(1)
      expect(flattenColor(recipient[0]!.props.style)).toBe(palette.text)
      expect(flattenColor(sentence.props.style)).toBe(palette.textSecondary)
    }
  )

  // Review of c714c9bc: one call `failed` with its error result, another
  // `failed` with no result. The run failed twice; the sentence, counting
  // error results, says "(1 failed)", and the label was withheld.
  it.each(['light', 'dark'] as const)(
    'says 2 failed when the sentence can only count 1 of them, in %s',
    (scheme) => {
      const mixed: NativeChatBlock[] = [
        { type: 'tool-call', name: 'shell', input: { command: 'a' }, state: 'failed' },
        { type: 'tool-result', output: 'exit 1', isError: true },
        { type: 'tool-call', name: 'shell', input: { command: 'b' }, state: 'failed' }
      ]
      const { texts } = render(mixed, scheme)
      expect(texts).toContain('Ran 2 commands (1 failed)')
      const mark = renderer!.root.findByProps({ testID: 'tool-run-failed-count' })
      expect(mark.props.children).toBe('2 failed')
      expect(mark.props.accessibilityLabel).toBe('Failed tool calls: 2')
    }
  )

  it('says nothing about failures on a clean run', () => {
    expect(render(LONG_RUN).texts.some((text) => text.endsWith(' failed'))).toBe(false)
    expect(renderer!.root.findAllByProps({ testID: 'tool-run-failed-count' })).toHaveLength(0)
  })

  // docs/claude-app-parity.md item 3: the green/red "+A −R" chip beside a run
  // that created or edited a file, the way the Claude app's own screenshot
  // draws "Ran 2 commands, created a file" next to a green "+292" and a red
  // "−0".
  it.each(['light', 'dark'] as const)(
    "draws the run's line-count chip in the diff colours, in %s",
    (scheme) => {
      const { texts } = render(RAN_2_COMMANDS_CREATED_FILE, scheme)
      expect(texts).toContain('Ran 2 commands, created a file')
      expect(texts).toContain('+2')
      expect(texts).toContain('−0')
      const added = renderer!.root.findByProps({ testID: 'tool-run-diff-added' })
      const removed = renderer!.root.findByProps({ testID: 'tool-run-diff-removed' })
      const palette = scheme === 'dark' ? darkColors : lightColors
      expect(flattenColor(added.props.style)).toBe(palette.diffAddText)
      expect(flattenColor(removed.props.style)).toBe(palette.diffDelText)
    }
  )

  it('draws no diff chip on a run that touched no file', () => {
    const { texts } = render(COMMAND_ONLY_RUN)
    expect(texts.some((text) => text.startsWith('+') || text.startsWith('−'))).toBe(false)
    expect(renderer!.root.findAllByProps({ testID: 'tool-run-diff-added' })).toHaveLength(0)
  })

  it('draws no diff chip when an edit call in the run has no result yet', () => {
    // LONG_RUN's Edit and Write calls carry no result and no lifecycle state,
    // so neither the sentence nor the chip can claim what they changed.
    const { texts } = render(LONG_RUN)
    expect(texts.some((text) => text.startsWith('+') || text.startsWith('−'))).toBe(false)
    expect(renderer!.root.findAllByProps({ testID: 'tool-run-diff-added' })).toHaveLength(0)
  })
})

// The Claude app's row, 2026-09-26 screenshot: "Ran 2 commands (1 failed),
// created a file [+15 −0] ›". The sentence whole, then a pill (green "+15" on
// a green tint joined to red "−0" on a red tint, rounded as one), then the
// chevron. Code UI cut the sentence to "Ran 2 commands (1 failed), …" behind a
// second "1 failed" and plain green/red text pinned to the right edge.
const FIFTEEN_LINES = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const RAN_2_COMMANDS_1_FAILED_CREATED_FILE: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'a' } },
  { type: 'tool-result', output: '' },
  { type: 'tool-call', name: 'Bash', input: { command: 'b' } },
  { type: 'tool-result', output: 'exit 1', isError: true },
  { type: 'tool-call', name: 'Write', input: { file_path: '/repo/NEW.md', content: FIFTEEN_LINES } },
  { type: 'tool-result', output: 'File created successfully at: /repo/NEW.md' }
]
const COMMAND_FAILED_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'false' } },
  { type: 'tool-result', output: 'exit 1', isError: true }
]
const LONG_NAME = `${'a-very-long-generated-module-name-'.repeat(4)}index.ts`
const LONG_SENTENCE_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: `/repo/src/${LONG_NAME}` } },
  { type: 'tool-result', output: 'ok' },
  ...RAN_2_COMMANDS_1_FAILED_CREATED_FILE
]
const EMPTY_FILE_CREATED: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Write', input: { file_path: '/repo/EMPTY.md', content: '' } },
  { type: 'tool-result', output: 'File created successfully at: /repo/EMPTY.md' }
]

describe('a finished run row as the Claude app draws it: sentence, pill, chevron', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(blocks: NativeChatBlock[], scheme: 'light' | 'dark'): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(Harness, { blocks }))
      )
    })
    return renderer!
  }

  function flat(style: unknown): Record<string, unknown> {
    const entries = (Array.isArray(style) ? style.flat(Infinity) : [style]) as unknown[]
    return Object.assign({}, ...entries.filter((entry) => entry && typeof entry === 'object'))
  }

  // What the header draws, left to right: the toggle's host children, with
  // any composite (the chip component) resolved to the views it renders.
  function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
    const out: ReactTestInstance[] = []
    for (const child of node.children) {
      if (typeof child === 'string') {
        continue
      }
      if (typeof child.type === 'string') {
        out.push(child)
      } else {
        out.push(...hostChildren(child))
      }
    }
    return out
  }

  function headerOrder(tree: ReactTestRenderer): string[] {
    const header = tree.root.findByProps({ testID: 'tool-run-header' })
    const host = header.findByType('Pressable' as never)
    return hostChildren(host).map(
      (child) => (child.props.testID as string | undefined) ?? String(child.type)
    )
  }

  function expectPill(
    tree: ReactTestRenderer,
    scheme: 'light' | 'dark',
    added: string,
    removed: string
  ): void {
    const palette = scheme === 'dark' ? darkColors : lightColors
    const sentence = flat(tree.root.findByProps({ testID: 'tool-run-sentence' }).props.style)
    const pill = tree.root.findAll(
      (node) => node.props?.testID === 'tool-run-diff-chip' && typeof node.type === 'string'
    )[0]!
    const pillStyle = flat(pill.props.style)
    expect(pillStyle.flexDirection).toBe('row')
    expect(pillStyle.overflow).toBe('hidden')
    expect(pillStyle.borderRadius).toBeGreaterThan(0)
    expect(pillStyle.flexShrink ?? 0).toBe(0)
    const segments = pill.findAllByType('Text' as never)
    expect(segments.map((segment) => segment.props.children)).toEqual([added, removed])
    const [plus, minus] = segments.map((segment) => flat(segment.props.style))
    expect(plus!.color).toBe(palette.diffAddText)
    expect(plus!.backgroundColor).toBe(palette.diffAddBg)
    expect(minus!.color).toBe(palette.diffDelText)
    expect(minus!.backgroundColor).toBe(palette.diffDelBg)
    for (const segment of [plus!, minus!]) {
      // 2026-09-28, the user: "reduce the size of lines written and number of lines removed pill".
      // Smaller than the sentence it follows, and tighter than an inline code pill, so it reads
      // as a tag beside the words rather than a second line of them.
      expect(segment.fontSize).toBeLessThan(sentence.fontSize)
      expect(segment.fontSize).toBeGreaterThanOrEqual(Math.round(sentence.fontSize * 0.8))
      expect(segment.paddingHorizontal).toBeLessThanOrEqual(4)
      expect(segment.paddingVertical ?? 0).toBe(0)
      expect(segment.margin ?? segment.marginHorizontal ?? 0).toBe(0)
    }
  }

  it.each(['light', 'dark'] as const)(
    'draws "Ran 2 commands (1 failed), created a file [+15 −0] ›" whole, in %s',
    (scheme) => {
      const tree = render(RAN_2_COMMANDS_1_FAILED_CREATED_FILE, scheme)
      expect(tree.root.findByProps({ testID: 'tool-run-sentence' }).props.children).toBe(
        'Ran 2 commands (1 failed), created a file'
      )
      expect(tree.root.findAllByProps({ testID: 'tool-run-failed-count' })).toHaveLength(0)
      expect(headerOrder(tree)).toEqual(['tool-run-sentence', 'tool-run-diff-chip', 'ChevronRight'])
      expectPill(tree, scheme, '+15', '−0')
    }
  )

  it.each(['light', 'dark'] as const)('draws the pill on a run with no failures, in %s', (scheme) => {
    const tree = render(RAN_2_COMMANDS_CREATED_FILE, scheme)
    expect(headerOrder(tree)).toEqual(['tool-run-sentence', 'tool-run-diff-chip', 'ChevronRight'])
    expectPill(tree, scheme, '+2', '−0')
  })

  it.each(['light', 'dark'] as const)(
    'draws a failure with no chip as the sentence and the chevron alone, in %s',
    (scheme) => {
      const tree = render(COMMAND_FAILED_RUN, scheme)
      expect(tree.root.findByProps({ testID: 'tool-run-sentence' }).props.children).toBe(
        'Ran a command (1 failed)'
      )
      expect(headerOrder(tree)).toEqual(['tool-run-sentence', 'ChevronRight'])
    }
  )

  it.each(['light', 'dark'] as const)(
    'lets a very long sentence ellipsize while the pill and chevron stay, in %s',
    (scheme) => {
      const tree = render(LONG_SENTENCE_RUN, scheme)
      const sentence = tree.root.findByProps({ testID: 'tool-run-sentence' })
      expect(String(sentence.props.children)).toContain(LONG_NAME)
      expect(sentence.props.numberOfLines).toBe(1)
      const style = flat(sentence.props.style)
      // Shrinks to fit, never grows: a growing sentence pins the pill to the
      // row's far edge instead of right after the words.
      expect(style.flexShrink).toBe(1)
      expect(style.flex ?? 0).toBe(0)
      expect(style.flexGrow ?? 0).toBe(0)
      // Its "(1 failed)" sits past the long name, behind the ellipsis, so the
      // row says it again where it cannot be cut.
      expect(headerOrder(tree)).toEqual([
        'tool-run-sentence',
        'tool-run-failed-count',
        'tool-run-diff-chip',
        'ChevronRight'
      ])
      const label = tree.root.findByProps({ testID: 'tool-run-failed-count' })
      expect(flat(label.props.style).flexShrink ?? 0).toBe(0)
      expectPill(tree, scheme, '+15', '−0')
    }
  )

  it.each(['light', 'dark'] as const)('draws "+0 −0" as a whole pill, in %s', (scheme) => {
    const tree = render(EMPTY_FILE_CREATED, scheme)
    expect(headerOrder(tree)).toEqual(['tool-run-sentence', 'tool-run-diff-chip', 'ChevronRight'])
    expectPill(tree, scheme, '+0', '−0')
  })
})

// A live turn: a `shell` call still running, and one already settled behind it.
const LIVE_SHELL_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' },
  { type: 'tool-call', name: 'shell', input: { command: 'pnpm test' }, state: 'running' }
]
// Codex's classified shell row: the word is `read`, but it really ran a command.
const LIVE_CLASSIFIED_RUN: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'read',
    input: { command: 'cat src/app.ts', path: 'src/app.ts' },
    state: 'running'
  }
]
// Claude's `Read` shares that word and ran no command at all.
const LIVE_CLAUDE_READ_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: 'src/app.ts' }, state: 'running' }
]

describe('a tool run while the turn is still working', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    props: Parameters<typeof Harness>[0],
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(Harness, props))
      )
    })
    return renderer!
  }

  function texts(tree: ReactTestRenderer): string[] {
    // `{callCount}×` arrives as `[2, '×']`, so join primitive children rather
    // than only taking the ones that are already a single string.
    return tree.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return (Array.isArray(children) ? children : [children])
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .join('')
    })
  }

  function activeLabelColor(tree: ReactTestRenderer): string | undefined {
    const label = tree.root.findAll((node) => node.props?.testID === 'tool-run-active-label')[0]
    return flattenColor(label?.props.style)
  }

  /** The drawn label Text, not the ShimmerText element that hands it the testID. */
  function activeLabel(tree: ReactTestRenderer) {
    return tree.root.find(
      (node) => node.props?.testID === 'tool-run-active-label' && String(node.type) === 'Text'
    )
  }

  /** The label's glyphs while it shimmers: one span per character. */
  function activeGlyphs(tree: ReactTestRenderer): string[] {
    const label = activeLabel(tree)
    return label
      .findAll((node) => String(node.type) === 'Text' && node !== label)
      .map((node) => String(node.props.children))
  }

  function opacityOf(style: unknown): unknown {
    return [style].flat(3).reduce<unknown>((found, entry) => (entry as { opacity?: unknown } | null)?.opacity ?? found, undefined)
  }

  it('names the call that is still running instead of counting the settled ones', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    expect(activeGlyphs(tree).join('')).toBe('Running')
    // The batch sentence is what the live row replaces.
    expect(texts(tree).some((text) => text.startsWith('Ran '))).toBe(false)
  })

  // 2026-09-26, the user, with a recording of the Claude app: "Running agents
  // animations must be like this". There the icon stands still and a darker
  // band sweeps across the label; nothing fades as a whole. Until then the
  // icon and the label breathed together (d96fef9b).
  it('sweeps a shimmer across the Running label while a call is live, and breathes nothing', () => {
    mocks.loop.mockClear()
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    expect(activeGlyphs(tree)).toEqual(['R', 'u', 'n', 'n', 'i', 'n', 'g'])
    expect(mocks.loop).not.toHaveBeenCalled()
  })

  it('keeps the running tool icon still beside the shimmering label', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    const header = tree.root.find((node) => node.props?.testID === 'tool-run-active-header')
    expect(header.findAll((node) => String(node.type) === 'SquareTerminal')).toHaveLength(1)
    expect(header.findAll((node) => opacityOf(node.props?.style) !== undefined)).toEqual([])
  })

  // "Remove animations" on, and "Running" kept breathing (0.6.6 audit).
  // The word is still on the row, whole, with no sweep.
  it('holds the Running label still under reduced motion', () => {
    mocks.reduced = true
    mocks.loop.mockClear()
    try {
      const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
      expect(mocks.loop).not.toHaveBeenCalled()
      expect(activeGlyphs(tree)).toEqual([])
      expect(texts(tree)).toContain('Running')
    } finally {
      mocks.reduced = false
    }
  })

  it('goes back to the batch summary the moment the turn settles', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: false })
    expect(texts(tree)).toContain('Read a.ts, ran a command')
    expect(texts(tree).some((text) => text.startsWith('Running'))).toBe(false)
  })

  it('gives a Codex row that really ran a command the terminal glyph', () => {
    const tree = render({ blocks: LIVE_CLASSIFIED_RUN, activeTurnIsWorking: true })
    expect(tree.root.findAllByType('SquareTerminal')).toHaveLength(1)
    expect(tree.root.findAllByType('Wrench')).toHaveLength(0)
  })

  it("does not claim a shell ran for Claude's Read, which shares the word", () => {
    const tree = render({ blocks: LIVE_CLAUDE_READ_RUN, activeTurnIsWorking: true })
    expect(tree.root.findAllByType('Wrench')).toHaveLength(1)
    expect(tree.root.findAllByType('SquareTerminal')).toHaveLength(0)
  })

  it('keeps the running label on the theme, in light and in dark', () => {
    const lightColor = activeLabelColor(
      render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    )
    act(() => renderer?.unmount())
    renderer = null
    const darkColor = activeLabelColor(
      render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true }, 'dark')
    )
    expect(lightColor).toBe(lightColors.textSecondary)
    expect(darkColor).toBe(darkColors.textSecondary)
    expect(darkColor).not.toBe(lightColor)
  })

  it('leaves the child rows shut when the turn caret is what opened the run', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, defaultExpanded: true, expandChildren: false })
    // The run body is open — the settled call's row is on screen — but the row
    // itself has not disclosed its result.
    expect(texts(tree)).toContain('a.ts')
    expect(texts(tree)).not.toContain('ok')
  })
})

// A run of one generic call, the shape the evidence's SendMessage sheet used.
const SINGLE_BASH_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
  { type: 'tool-result', output: 'a.ts\nb.ts' }
]
const SINGLE_PLAN_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'TodoWrite', input: { todos: [{ content: 'Write the test' }] } },
  { type: 'tool-result', output: 'ok' }
]

describe('tapping a tool row opens the Claude-app detail sheet', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(blocks: NativeChatBlock[]): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: 'light' }, createElement(Harness, { blocks }))
      )
    })
    return renderer!
  }

  function sheetPair(tree: ReactTestRenderer) {
    return tree.root.findByType('MobileNativeChatToolDetailSheet').props.pair
  }

  it('opens the sheet straight from a single-call run\'s header — nothing to reveal first', () => {
    const tree = render(SINGLE_BASH_RUN)
    expect(sheetPair(tree)).toBeNull()
    const header = tree.root.findByProps({ testID: 'tool-run-header' })
    act(() => header.props.onPress())
    expect(sheetPair(tree)?.call?.name).toBe('Bash')
    // No inline body was ever revealed — the header opened the sheet, not the
    // old reveal-first row.
    expect(tree.root.findAllByProps({ testID: 'tool-line' })).toHaveLength(0)
  })

  it('closes the sheet when the run hands back onClose', () => {
    const tree = render(SINGLE_BASH_RUN)
    act(() => tree.root.findByProps({ testID: 'tool-run-header' }).props.onPress())
    expect(sheetPair(tree)).not.toBeNull()
    act(() => tree.root.findByType('MobileNativeChatToolDetailSheet').props.onClose())
    expect(sheetPair(tree)).toBeNull()
  })

  it("keeps a single plan run's old reveal-first header — a checklist has its own card", () => {
    const tree = render(SINGLE_PLAN_RUN)
    const header = tree.root.findByProps({ testID: 'tool-run-header' })
    act(() => header.props.onPress())
    // The sheet never opened; the header instead revealed the one child row.
    expect(sheetPair(tree)).toBeNull()
    expect(tree.root.findAllByProps({ testID: 'tool-line' })).toHaveLength(1)
  })

  it('keeps a multi-call run\'s header as reveal-first, then opens the sheet per call', () => {
    const tree = render(LONG_RUN)
    const header = tree.root.findByProps({ testID: 'tool-run-header' })
    act(() => header.props.onPress())
    expect(sheetPair(tree)).toBeNull()
    const lines = tree.root.findAllByProps({ testID: 'tool-line' })
    expect(lines.length).toBeGreaterThan(1)
    act(() => lines[0]!.props.onPress())
    expect(sheetPair(tree)?.call?.name).toBe('Bash')
  })

  it("does not open the sheet for a plan call inside an expanded multi-call run", () => {
    const tree = render([...SINGLE_PLAN_RUN, ...SINGLE_BASH_RUN])
    act(() => tree.root.findByProps({ testID: 'tool-run-header' }).props.onPress())
    const lines = tree.root.findAllByProps({ testID: 'tool-line' })
    act(() => lines[0]!.props.onPress())
    // The plan row's own tap expanded its checklist inline; it did not open a
    // sheet, which the second call in the same run still can.
    expect(sheetPair(tree)).toBeNull()
    act(() => lines[1]!.props.onPress())
    expect(sheetPair(tree)?.call?.name).toBe('Bash')
  })
})

describe('the running row lays out like the settled one', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // Review of c714c9bc: the settled row's chevron follows its sentence, but
  // the running row's label grew to fill the row and pinned its chevron to
  // the far edge, so the chevron jumped left the moment the run settled.
  it.each(['light', 'dark'] as const)(
    'keeps the chevron right after the Running label, where it sits once the run settles, in %s',
    (scheme) => {
      act(() => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(Harness, { blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
          )
        )
      })
      const tree = renderer!
      const label = tree.root.findAll(
        (node) => node.props?.testID === 'tool-run-active-label' && typeof node.type === 'string'
      )[0]!
      const entries = (
        Array.isArray(label.props.style) ? label.props.style.flat(Infinity) : [label.props.style]
      ) as (Record<string, unknown> | null)[]
      const style = Object.assign({}, ...entries.filter(Boolean)) as Record<string, unknown>
      expect(style.flex ?? 0).toBe(0)
      expect(style.flexGrow ?? 0).toBe(0)
      expect(style.flexShrink).toBe(1)
      const toggle = tree.root
        .findByProps({ testID: 'tool-run-active-header' })
        .findByType('Pressable' as never)
      const order = toggle.children
        .filter((child): child is ReactTestInstance => typeof child !== 'string')
        .map((child) => (child.props.testID as string | undefined) ?? String(child.type))
      expect(order.indexOf('ChevronRight')).toBe(order.indexOf('tool-run-active-label') + 1)
    }
  )
})
