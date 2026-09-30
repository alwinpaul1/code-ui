import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// A tool run shows its first six calls. Past them the body ended at "… 6 more
// tool calls", plain text with no onPress, so calls 7-12 — a failed one among
// them, and its detail sheet — could not be reached at all, while the header
// said "1 failed". The plan preview was read over the same first six, so a
// TodoWrite or update_plan later in a long run drew no plan line (review,
// 2026-09-30). The cap is this client's own: the desktop's NativeChatToolRun
// draws every call, and src/shared's pairToolBlocks takes no limit unless
// asked for one.

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
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

function Harness({
  blocks,
  defaultExpanded = false
}: {
  blocks: NativeChatBlock[]
  defaultExpanded?: boolean
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded, activeCall: null, styles })
}

/** `count` Bash calls, `cmd-1` … `cmd-N`; the ones listed in `failed` error. */
function commands(count: number, failed: readonly number[] = []): NativeChatBlock[] {
  return Array.from({ length: count }, (_, i) => i + 1).flatMap((n): NativeChatBlock[] => [
    { type: 'tool-call', name: 'Bash', input: { command: `cmd-${n}` } },
    {
      type: 'tool-result',
      output: failed.includes(n) ? 'exit 1' : 'ok',
      ...(failed.includes(n) ? { isError: true } : {})
    }
  ])
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(
  blocks: NativeChatBlock[],
  scheme: 'light' | 'dark',
  { defaultExpanded = false }: { defaultExpanded?: boolean } = {}
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Harness blocks={blocks} defaultExpanded={defaultExpanded} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

function openRun(root: ReactTestInstance): void {
  act(() => root.findByProps({ testID: 'tool-run-header' }).props.onPress())
}

const lines = (root: ReactTestInstance): ReactTestInstance[] => root.findAllByProps({ testID: 'tool-line' })

/** The row that stands in for the calls past the cap, as a button. */
const moreButtons = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityRole === 'button' &&
      /more tool call/.test(String(node.props.accessibilityLabel ?? ''))
  )

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a tool run longer than its first six calls, %s', (scheme, palette) => {
  it('opens every call of a 12-command run from its "more" row, the failed 9th included', () => {
    const root = render(commands(12, [9]), scheme)
    // The header says a call failed ("Ran 12 commands (1 failed)").
    expect(toolRunSentence(commands(12, [9]))).toBe('Ran 12 commands (1 failed)')
    openRun(root)
    expect(lines(root)).toHaveLength(6)
    const [more] = moreButtons(root)
    expect(more?.props.accessibilityLabel).toBe('Show 6 more tool calls')
    const label = more!.findByType('Text' as never)
    expect(label.props.children).toBe('Show 6 more tool calls')
    expect(flat(label.props.style).color).toBe(palette.accentText)
    act(() => more!.props.onPress())
    expect(lines(root)).toHaveLength(12)
    expect(moreButtons(root)).toHaveLength(0)
    // The failed call's detail sheet is one tap away.
    act(() => lines(root)[8]!.props.onPress())
    const sheet = root.findByType('MobileNativeChatToolDetailSheet' as never)
    expect(sheet.props.pair.call.input).toEqual({ command: 'cmd-9' })
    expect(sheet.props.pair.result.isError).toBe(true)
  })

  it('draws a plan made after the sixth call as the run\'s plan line', () => {
    const blocks: NativeChatBlock[] = [
      ...commands(7),
      {
        type: 'tool-call',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Write the test', status: 'in_progress', activeForm: 'Writing the test' }] }
      },
      { type: 'tool-result', output: 'ok' }
    ]
    const root = render(blocks, scheme)
    const plan = root.findAllByProps({ testID: 'tool-run-member-arg' })
    expect(plan.map((node) => String(node.props.children))).toEqual(['0/1 · Writing the test'])
  })

  it('draws no "more" row for exactly six calls, and one for exactly seven', () => {
    const six = render(commands(6), scheme)
    openRun(six)
    expect(lines(six)).toHaveLength(6)
    expect(moreButtons(six)).toHaveLength(0)
    act(() => renderer?.unmount())
    const seven = render(commands(7), scheme)
    openRun(seven)
    expect(lines(seven)).toHaveLength(6)
    const [more] = moreButtons(seven)
    expect(more?.props.accessibilityLabel).toBe('Show 1 more tool call')
    act(() => more!.props.onPress())
    expect(lines(seven)).toHaveLength(7)
  })

  it('keeps a one-call run as it was', () => {
    const one = render(commands(1), scheme)
    expect(moreButtons(one)).toHaveLength(0)
    expect(lines(one)).toHaveLength(0)
  })
})

// "Show N more tool calls" split the run's 240 diff rows over every call then
// shown, so the tap cut the diffs the reader was reading: each of the first
// six Edit cards fell from 20 rows to 10 for a 12-call run, to 17 for seven,
// and to 1 for 120 (review, 2026-09-30). Every line now draws the budget of
// the run's first page, and a call the tap reveals comes in closed, so the
// run never draws more diff rows at once than its first six did.

/** One side of an edit, `old-3-17` / `new-3-17`: no two lines match, so a
 *  40-line old_string against a 40-line new_string is 80 changed rows. */
function snippet(side: 'old' | 'new', n: number): string {
  return Array.from({ length: 40 }, (_, i) => `${side}-${n}-${i + 1}`).join('\n')
}

/** `count` Claude Code Edit calls, each answered in 2.1.282's wording
 *  (fixtures/claude-edit-runs-2.1.282.ts). */
function edits(count: number): NativeChatBlock[] {
  return Array.from({ length: count }, (_, i) => i + 1).flatMap((n): NativeChatBlock[] => [
    {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: `/w/src/file-${n}.ts`, old_string: snippet('old', n), new_string: snippet('new', n) }
    },
    {
      type: 'tool-result',
      output: `The file /w/src/file-${n}.ts has been updated successfully. (file state is current in your context — no need to Read it back)`
    }
  ])
}

/** The diff rows each line of the run draws, in order; 0 for a closed line. */
const rowsPerLine = (root: ReactTestInstance): number[] =>
  lines(root).map((line) => line.parent!.findAllByProps({ testID: 'diff-card-text' }).length)

const totalRows = (root: ReactTestInstance): number =>
  root.findAllByProps({ testID: 'diff-card-text' }).length

function tapMore(root: ReactTestInstance): void {
  const buttons = moreButtons(root)
  expect(buttons).toHaveLength(1)
  act(() => buttons[0]!.props.onPress())
}

const rowsOf = (count: number, rows: number): number[] => Array.from({ length: count }, () => rows)

describe.each(['light', 'dark'] as const)('the diffs of a run of edits past six calls, %s', (scheme) => {
  it('keeps the six diffs already open at 20 rows when "Show 6 more tool calls" is tapped', () => {
    const root = render(edits(12), scheme, { defaultExpanded: true })
    expect(rowsPerLine(root)).toEqual(rowsOf(6, 20))
    expect(totalRows(root)).toBe(120)
    tapMore(root)
    expect(lines(root)).toHaveLength(12)
    expect(rowsPerLine(root)).toEqual([...rowsOf(6, 20), ...rowsOf(6, 0)])
    // The six the tap revealed come in closed, and each opens to the same 20.
    act(() => lines(root)[6]!.props.onPress())
    act(() => lines(root)[11]!.props.onPress())
    expect(rowsPerLine(root)).toEqual([...rowsOf(7, 20), ...rowsOf(4, 0), 20])
  })

  it('keeps the first six at 20 rows when one hidden call is revealed, and opens that one to 20', () => {
    const root = render(edits(7), scheme, { defaultExpanded: true })
    expect(rowsPerLine(root)).toEqual(rowsOf(6, 20))
    tapMore(root)
    expect(rowsPerLine(root)).toEqual([...rowsOf(6, 20), 0])
    act(() => lines(root)[6]!.props.onPress())
    expect(rowsPerLine(root)).toEqual(rowsOf(7, 20))
  })

  it('draws no more diff rows at once for a 120-edit run than for its first six', () => {
    const root = render(edits(120), scheme, { defaultExpanded: true })
    expect(rowsPerLine(root)).toEqual(rowsOf(6, 20))
    tapMore(root)
    expect(lines(root)).toHaveLength(120)
    expect(rowsPerLine(root).slice(0, 6)).toEqual(rowsOf(6, 20))
    // Not 120 × 20: the revealed calls wait, closed, for the reader.
    expect(totalRows(root)).toBe(120)
    act(() => lines(root)[99]!.props.onPress())
    expect(rowsPerLine(root)[99]).toBe(20)
    expect(totalRows(root)).toBe(140)
  })

  it('draws a run of six edits or fewer exactly as before: 240 rows over its calls, two diffs each', () => {
    // floor(240 / (calls × 2)) rows per diff, and a 40-line edit has 80.
    const perDiff: Record<number, number> = { 1: 80, 2: 60, 3: 40, 4: 30, 5: 24, 6: 20 }
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const root = render(edits(count), scheme, { defaultExpanded: true })
      expect(moreButtons(root)).toHaveLength(0)
      expect(rowsPerLine(root)).toEqual(rowsOf(count, perDiff[count]!))
      act(() => renderer?.unmount())
      renderer = null
    }
  })
})

// The button compared tool-call blocks with the rows shown, but a result
// whose call the window cut (a run that opens part-way through) is a row of
// its own. One such result and six calls made seven rows, six were shown,
// no button was drawn, and the sixth call could not be reached (review,
// 2026-09-30).

const CUT_CALLS_RESULT: NativeChatBlock = { type: 'tool-result', output: 'ok' }

describe.each(['light', 'dark'] as const)('a run that opens with a result whose call was cut, %s', (scheme) => {
  it('offers its sixth call behind "Show 1 more tool call"', () => {
    const root = render([CUT_CALLS_RESULT, ...commands(6)], scheme)
    openRun(root)
    expect(lines(root)).toHaveLength(6)
    const [more] = moreButtons(root)
    expect(more?.props.accessibilityLabel).toBe('Show 1 more tool call')
    act(() => more!.props.onPress())
    expect(lines(root)).toHaveLength(7)
    expect(moreButtons(root)).toHaveLength(0)
    const [preview] = lines(root)[6]!.findAllByProps({ testID: 'tool-line-preview' })
    expect(preview?.props.children).toBe('cmd-6')
  })

  it('draws no button for six rows, one of them the cut call\'s result', () => {
    const root = render([CUT_CALLS_RESULT, ...commands(5)], scheme)
    openRun(root)
    expect(lines(root)).toHaveLength(6)
    expect(moreButtons(root)).toHaveLength(0)
  })

  it('opens a run that is only the cut call\'s result straight to its sheet, with no button', () => {
    const root = render([CUT_CALLS_RESULT], scheme)
    openRun(root)
    expect(lines(root)).toHaveLength(0)
    expect(moreButtons(root)).toHaveLength(0)
    const sheet = root.findByType('MobileNativeChatToolDetailSheet' as never)
    expect(sheet.props.pair).toEqual({ result: CUT_CALLS_RESULT })
  })

  it('counts all seven rows of a run of nothing but cut calls\' results in its header, before and after the tap', () => {
    const root = render(Array.from({ length: 7 }, () => CUT_CALLS_RESULT), scheme)
    const header = (): string =>
      String(root.findByProps({ testID: 'tool-run-sentence' }).props.children)
    expect(header()).toBe('7 tool calls')
    openRun(root)
    expect(lines(root)).toHaveLength(6)
    tapMore(root)
    expect(lines(root)).toHaveLength(7)
    expect(header()).toBe('7 tool calls')
  })

  it('draws no row and no button for an empty run', () => {
    const root = render([], scheme)
    openRun(root)
    expect(lines(root)).toHaveLength(0)
    expect(moreButtons(root)).toHaveLength(0)
  })
})
