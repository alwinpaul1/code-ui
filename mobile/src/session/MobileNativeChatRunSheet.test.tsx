import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { agentRunState } from './mobile-native-chat-agent-run'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatRunSheet } from './MobileNativeChatRunSheet'
import {
  MIXED_RUN_AGENT_DESCRIPTION,
  MIXED_RUN_AGENT_ID,
  mixedRunWithBackgroundAgent
} from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['Briefcase', 'Eye', 'FileText', 'Globe', 'ListTodo', 'MessageSquare', 'Search', 'Sparkles', 'SquareTerminal', 'TextCursorInput', 'TriangleAlert', 'Wrench', 'X'].map(
      (name) => [name, name]
    )
  )
)
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children: ReactNode }) =>
    visible ? (
      <>
        {header}
        {children}
      </>
    ) : null
}))

const BLOCKS = mixedRunWithBackgroundAgent()
const ENTRIES = agentRunState(BLOCKS, {
  runningIds: new Set([MIXED_RUN_AGENT_ID]),
  confirmed: new Map(),
  agentWorking: false
}).entries

function texts(tree: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of tree.root.findAllByType('Text' as never)) {
    for (const child of [node.props.children].flat()) {
      if (typeof child === 'string') {
        out.push(child)
      }
    }
  }
  return out
}

function colorsOf(tree: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of tree.root.findAll((n) => typeof n.props.color === 'string')) {
    out.push(node.props.color)
  }
  for (const node of tree.root.findAllByType('Text' as never)) {
    for (const entry of [node.props.style].flat(3)) {
      if (entry && typeof entry.color === 'string') {
        out.push(entry.color)
      }
    }
  }
  return out
}

describe('the sheet behind a run of CronDelete, three commands and an agent', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    props: Partial<Parameters<typeof MobileNativeChatRunSheet>[0]> = {},
    scheme: 'light' | 'dark' = 'light'
  ) {
    const onSelectPair = vi.fn<(pair: NativeChatToolPair, agentId: string | null) => void>()
    const onClose = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatRunSheet
            visible
            title={toolRunSentence(BLOCKS, 0)}
            rows={runSheetRows(BLOCKS, ENTRIES)}
            onSelectPair={onSelectPair}
            onClose={onClose}
            {...props}
          />
        </ThemeProvider>
      )
    })
    return { tree: renderer!, onSelectPair, onClose }
  }

  const rowNodes = (tree: ReactTestRenderer): ReactTestInstance[] =>
    tree.root.findAll((node) => node.props.testID === 'run-sheet-row' && String(node.type) === 'Pressable')

  // The label is the Claude app's for a run holding a described agent (h330.i,
  // `ccr_summary_agent_described_more`; tool-run-sentence-agent-described.test.ts).
  // Re-pinned deliberately: the 2026-10-01 screenshot titled this sheet with the
  // grouped sentence, from a build whose run-label code was not traced.
  it('is titled with the past-tense sentence while the agent still runs', () => {
    const { tree } = render()
    expect(texts(tree)).toContain(`Ran agent: ${MIXED_RUN_AGENT_DESCRIPTION} (+4 tools)`)
  })

  it('lists five rows with a verb and its description, not a raw tool name and input', () => {
    const { tree } = render()
    expect(rowNodes(tree)).toHaveLength(5)
    const shown = texts(tree)
    expect(shown).toContain('Used CronDelete')
    expect(shown).toContain('id')
    expect(shown).toContain('Ran agent')
    expect(shown).toContain(MIXED_RUN_AGENT_DESCRIPTION)
    expect(shown.join('\n')).not.toContain('ssh')
    expect(shown.join('\n')).not.toContain('{')
  })

  it('hands a tapped row back with its own call', () => {
    const { tree, onSelectPair } = render()
    act(() => rowNodes(tree)[1]!.props.onPress())
    expect(onSelectPair).toHaveBeenCalledTimes(1)
    expect(onSelectPair.mock.calls[0]![0].call?.name).toBe('Bash')
  })

  // Parity gap G29: the Claude app opens the Agent call's own sheet (its
  // prompt, then "Tool calls (N)"), and the transcript from there.
  it("opens a known agent's own call sheet from its row, naming the agent", () => {
    const { tree, onSelectPair } = render()
    act(() => rowNodes(tree)[4]!.props.onPress())
    expect(onSelectPair).toHaveBeenCalledTimes(1)
    const [pair, agentId] = onSelectPair.mock.calls[0]!
    expect(agentId).toBe(MIXED_RUN_AGENT_ID)
    expect(pair.call?.name).toBe('Agent')
  })

  it('opens any other row with no agent named', () => {
    const { tree, onSelectPair } = render()
    act(() => rowNodes(tree)[1]!.props.onPress())
    expect(onSelectPair.mock.calls[0]![1]).toBeNull()
  })

  // The generic detail sheet of a launch showed its result's "internal metadata,
  // never quote" text, so an agent row with no known id is not tappable.
  it('leaves an agent row with no known id disabled, opening nothing', () => {
    const { tree, onSelectPair } = render({ rows: runSheetRows(BLOCKS, []) })
    const row = rowNodes(tree)[4]!
    expect(row.props.disabled).toBe(true)
    act(() => row.props.onPress?.())
    expect(onSelectPair).not.toHaveBeenCalled()
    expect(rowNodes(tree).slice(0, 4).every((node) => node.props.disabled !== true)).toBe(true)
  })

  it('marks a failed call with a warning triangle in the danger tone, and no other row', () => {
    const failed = mixedRunWithBackgroundAgent()
    const at = failed.findIndex((block) => block.type === 'tool-result' && block.output === 'cancelled 2 jobs')
    failed[at] = { type: 'tool-result', output: 'ssh: timed out', isError: true }
    const { tree } = render({ rows: runSheetRows(failed, []) })
    const marks = tree.root.findAll((node) => node.props.testID === 'run-sheet-row-failed')
    expect(marks).toHaveLength(1)
    // A screen reader hears the row's label, not its children.
    const labels = rowNodes(tree).map((node) => String(node.props.accessibilityLabel))
    expect(labels.filter((label) => label.includes('Failed'))).toEqual([expect.stringContaining('Ran Cancel our two')])
    expect(labels.filter((label) => !label.includes('Failed'))).toHaveLength(4)
    expect(colorsOf(tree)).toContain(lightColors.danger)
  })

  it('says so when a run has no calls, rather than drawing an empty sheet', () => {
    const { tree } = render({ rows: [], title: 'Tool calls' })
    expect(rowNodes(tree)).toHaveLength(0)
    expect(texts(tree)).toContain('No tool calls in this run.')
  })

  it('draws a single row for a single call', () => {
    const one = runSheetRows(BLOCKS.slice(0, 2), [])
    expect(render({ rows: one }).tree.root.findAll((n) => n.props.testID === 'run-sheet-row' && String(n.type) === 'Pressable')).toHaveLength(1)
  })

  it('draws every row of a 120-call run', () => {
    const many = Array.from({ length: 120 }, (_, i) => [
      { type: 'tool-call' as const, name: 'Bash', input: { command: `echo ${i}`, description: `Step ${i}` } },
      { type: 'tool-result' as const, output: String(i) }
    ]).flat()
    const { tree } = render({ rows: runSheetRows(many, []), title: 'Ran 120 commands' })
    expect(rowNodes(tree)).toHaveLength(120)
  })

  it('draws nothing while it is closed', () => {
    const { tree } = render({ visible: false })
    expect(tree.root.findAll((node) => node.props.testID === 'run-sheet')).toHaveLength(0)
  })

  it.each([
    ['light', lightColors, darkColors],
    ['dark', darkColors, lightColors]
  ] as const)('paints from the theme in %s, with no colour of the other scheme', (scheme, own, other) => {
    const { tree } = render({}, scheme)
    const painted = colorsOf(tree)
    expect(painted).toContain(own.textMuted)
    expect(painted).toContain(own.text)
    expect(painted).not.toContain(other.textMuted)
    expect(painted).not.toContain(other.text)
  })
})
