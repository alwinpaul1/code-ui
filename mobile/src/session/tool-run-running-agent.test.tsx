import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import {
  MIXED_RUN_AGENT_DESCRIPTION,
  MIXED_RUN_AGENT_ID,
  mixedRunWithBackgroundAgent
} from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      setValue(): void {}
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
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

// 2026-10-01, the user's screenshots: one turn called CronDelete, three Bash
// commands and a background Agent. The Claude app's row read "Running agent ›"
// while the agent worked; Code UI read "Used a tool, ran 3 commands, ran an
// agent" in the past tense. The fixture's inputs are stand-ins of the same shape.

//
// Since 2026-10-11 ("Running an Agent animation gets stuck") the row sweeps
// only while the launch is being made: the Agent call has no answer yet and
// the turn is live. Once the launch result is in it reads its sentence, the
// background agent still running or not (mobile-native-chat-agent-run.ts).

const RUNNING: NativeChatAgentRuns = {
  runningIds: new Set([MIXED_RUN_AGENT_ID]),
  confirmed: new Map(),
  agentWorking: true
}
const REPORTED: NativeChatAgentRuns = { ...RUNNING, runningIds: new Set() }

/** The run while the Agent call is still being made: its launch result not yet in. */
function launching(): NativeChatBlock[] {
  return mixedRunWithBackgroundAgent().slice(0, -1)
}

function Harness({
  blocks,
  activeTurnIsWorking,
  focusView,
  agentRuns
}: {
  blocks: NativeChatBlock[]
  activeTurnIsWorking?: boolean
  focusView?: boolean
  agentRuns: NativeChatAgentRuns
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(
    NativeChatAgentRunsContext.Provider,
    { value: agentRuns },
    createElement(ToolRun, {
      blocks,
      defaultExpanded: false,
      focusView,
      activeCall:
        activeTurnIsWorking === undefined ? null : selectActiveToolCall(blocks, { activeTurnIsWorking }),
      styles
    })
  )
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join('')
}

function flattenColor(style: unknown): string | undefined {
  for (const entry of [style].flat(3)) {
    if (entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string') {
      return (entry as { color: string }).color
    }
  }
  return undefined
}

describe('a mixed run whose background agent is still running', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: Parameters<typeof Harness>[0], scheme: 'light' | 'dark' = 'light') {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Harness {...props} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const isLabel = (node: ReactTestInstance) =>
    node.props?.testID === 'tool-run-agent-label' && String(node.type) === 'Text'

  /** The row as read: the shimmering label is one Text of one-glyph spans, so
   *  it is read whole, and the row's other Texts (the sentence, the failed
   *  count) outside it. */
  function headerText(tree: ReactTestRenderer): string {
    const inside = (node: ReactTestInstance): boolean =>
      isLabel(node) || (node.parent !== null && inside(node.parent))
    return tree.root
      .findByProps({ testID: 'tool-run-header' })
      .findAll((node) => String(node.type) === 'Text' && (isLabel(node) || !inside(node)))
      .filter((node) => !node.parent || String(node.parent.type) !== 'Text' || isLabel(node))
      .map((node) => textOf(node))
      .join('')
  }

  const agentLabel = (tree: ReactTestRenderer) => tree.root.find(isLabel)

  // 2026-10-09, same session side by side: the Claude app's row reads "Running
  // agent: Review: story flow ›". Ours read "Running agent  2 failed  +32 −0 ›".
  it("reads Running agent and the agent it names while a mixed run's agent launch is being made", () => {
    const tree = render({ blocks: launching(), agentRuns: RUNNING })
    expect(headerText(tree)).toBe(`Running agent: ${MIXED_RUN_AGENT_DESCRIPTION}`)
  })

  // The label is the Claude app's for a run holding a described agent (h330.i,
  // `ccr_summary_agent_described_more`; tool-run-sentence-agent-described.test.ts).
  // Re-pinned deliberately: the 2026-10-01 screenshot titled this sheet with the
  // grouped sentence, from a build whose run-label code was not traced.
  it('reads its sentence once the launch has answered, though the background agent still runs', () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), agentRuns: RUNNING })
    expect(headerText(tree)).toBe(`Ran agent: ${MIXED_RUN_AGENT_DESCRIPTION} (+4 tools)`)
    expect(tree.root.findAll(isLabel)).toHaveLength(0)
  })

  it('stops sweeping once the turn has ended with the launch never answered', () => {
    const tree = render({ blocks: launching(), agentRuns: { ...RUNNING, agentWorking: false } })
    expect(tree.root.findAll(isLabel)).toHaveLength(0)
  })

  it('names the first agent that still runs, not one that has reported', () => {
    const blocks: NativeChatBlock[] = [
      ...mixedRunWithBackgroundAgent().slice(0, 2),
      { type: 'tool-call', name: 'Agent', input: { description: 'Review: story flow', prompt: 'p' }, state: 'running' },
      { type: 'tool-call', name: 'Agent', input: { description: 'Review: integrity', prompt: 'p' }, state: 'running' }
    ]
    const tree = render({ blocks, agentRuns: { ...RUNNING, runningIds: new Set() } })
    expect(headerText(tree)).toBe('Running agent: Review: story flow')
  })

  it("says only Running agent when the run's agents name nothing", () => {
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Bash', input: { command: 'ls' }, state: 'completed' },
      { type: 'tool-result', output: 'x' },
      { type: 'tool-call', name: 'Agent', input: { prompt: 'p' }, state: 'running' }
    ]
    const tree = render({ blocks, agentRuns: { ...RUNNING, runningIds: new Set() } })
    expect(headerText(tree)).toBe('Running agent')
  })

  it('draws the two-diamond glyph and a shimmering label, with the chevron after them', () => {
    const tree = render({ blocks: launching(), agentRuns: RUNNING })
    const header = tree.root.findByProps({ testID: 'tool-run-header' })
    expect(header.findAllByProps({ testID: 'agent-run-glyph' })).not.toHaveLength(0)
    const glyphs = agentLabel(tree).findAll((node) => String(node.type) === 'Text' && node !== agentLabel(tree))
    expect(glyphs.length).toBeGreaterThan(1)
    const order = header
      .findByType('Pressable' as never)
      .children.filter((child): child is ReactTestInstance => typeof child !== 'string')
      .map((child) => (child.props.testID as string | undefined) ?? String(child.type))
    expect(order.indexOf('ChevronRight')).toBe(order.indexOf('tool-run-agent-label') + 1)
  })

  it('goes back to the sentence once the agent reports', () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), agentRuns: REPORTED })
    expect(headerText(tree)).toBe(`Ran agent: ${MIXED_RUN_AGENT_DESCRIPTION} (+4 tools)`)
  })

  it('keeps Running while a command is live beside the agent', () => {
    const blocks = mixedRunWithBackgroundAgent()
    blocks.push({ type: 'tool-call', name: 'Bash', input: { command: 'sleep 30' }, state: 'running' })
    const tree = render({ blocks, activeTurnIsWorking: true, agentRuns: RUNNING })
    expect(tree.root.findAllByProps({ testID: 'tool-run-active-header' })).toHaveLength(1)
    expect(tree.root.findAllByProps({ testID: 'tool-run-header' })).toHaveLength(0)
  })

  it('never reads Running agent for a run with no agent call, whatever the launch ids say', () => {
    const blocks = mixedRunWithBackgroundAgent().slice(0, -2)
    const tree = render({ blocks, agentRuns: { ...RUNNING, agentWorking: true } })
    expect(headerText(tree)).toBe('Used a tool, ran 3 commands')
  })

  // Claude Code writes results in the order they are acknowledged, and Orca drops
  // the tool_use ids: a background launch's answer can land before an earlier
  // call's. Paired by order, the Read's slot held the launch text.
  it('settles when the launch result lands before the earlier call\'s result', () => {
    const [agentCall, launch] = mixedRunWithBackgroundAgent().slice(-2)
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Read', input: { file_path: 'notes.md' }, state: 'completed' },
      agentCall!,
      launch!,
      { type: 'tool-result', output: '# Notes' }
    ]
    const tree = render({ blocks, agentRuns: RUNNING })
    expect(tree.root.findAll(isLabel)).toHaveLength(0)
  })

  it('reads Running agent while the launch is unanswered, though the earlier call has answered', () => {
    const [agentCall] = mixedRunWithBackgroundAgent().slice(-2)
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Read', input: { file_path: 'notes.md' }, state: 'completed' },
      { type: 'tool-result', output: '# Notes' },
      agentCall!
    ]
    const tree = render({ blocks, agentRuns: RUNNING })
    expect(headerText(tree)).toBe(`Running agent: ${MIXED_RUN_AGENT_DESCRIPTION}`)
  })

  // The failure count and the +A −R pill stay in the sheet (its title and its
  // file rows); the collapsed row says what is running and nothing else.
  it('leaves the failed count and the line-count pill off the Running agent row', () => {
    const blocks = launching()
    const at = blocks.findIndex((block) => block.type === 'tool-result' && block.output === 'cancelled 2 jobs')
    blocks[at] = { type: 'tool-result', output: 'ssh: timed out', isError: true }
    // Before the Agent call, which stays unanswered: the launch is being made.
    blocks.splice(
      -1,
      0,
      { type: 'tool-call', name: 'Write', input: { file_path: '/repo/NEW.md', content: 'x\ny\n' } },
      { type: 'tool-result', output: 'File created successfully at: /repo/NEW.md' }
    )
    const tree = render({ blocks, agentRuns: RUNNING })
    expect(headerText(tree)).toBe(`Running agent: ${MIXED_RUN_AGENT_DESCRIPTION}`)
    expect(tree.root.findAllByProps({ testID: 'tool-run-failed-count' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ testID: 'tool-run-diff-chip' })).toHaveLength(0)
  })

  it('keeps the pill on the finished row, where the sentence says what ran', () => {
    const blocks = mixedRunWithBackgroundAgent()
    blocks.push(
      { type: 'tool-call', name: 'Write', input: { file_path: '/repo/NEW.md', content: 'x\ny\n' } },
      { type: 'tool-result', output: 'File created successfully at: /repo/NEW.md' }
    )
    const tree = render({ blocks, agentRuns: REPORTED })
    expect(tree.root.findAllByProps({ testID: 'tool-run-diff-chip' })).not.toHaveLength(0)
  })

  it('announces the agent it names, as the row says it', () => {
    const tree = render({ blocks: launching(), agentRuns: RUNNING })
    expect(tree.root.findByProps({ testID: 'tool-run-header' }).props.accessibilityLabel).toBe(
      `Running agent: ${MIXED_RUN_AGENT_DESCRIPTION}`
    )
  })

  it('says only the count in focus view, where the row never names what ran', () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), focusView: true, agentRuns: RUNNING })
    expect(headerText(tree)).toBe('5 tool calls')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('keeps the label and glyph on the theme, in %s', (scheme, palette) => {
    const tree = render({ blocks: launching(), agentRuns: RUNNING }, scheme)
    expect(flattenColor(agentLabel(tree).props.style)).toBe(palette.textSecondary)
    expect(tree.root.findByProps({ testID: 'agent-run-glyph' }).props.children.props.stroke).toBe(
      palette.textMuted
    )
  })
})
