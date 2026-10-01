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

const RUNNING: NativeChatAgentRuns = {
  runningIds: new Set([MIXED_RUN_AGENT_ID]),
  confirmed: new Map(),
  agentWorking: false
}
const REPORTED: NativeChatAgentRuns = { ...RUNNING, runningIds: new Set() }

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

  it("reads Running agent while a mixed run's background agent still runs", () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), agentRuns: RUNNING })
    expect(headerText(tree)).toBe('Running agent')
  })

  it('draws the two-diamond glyph and a shimmering label, with the chevron after them', () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), agentRuns: RUNNING })
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
    expect(headerText(tree)).toBe('Used a tool, ran 3 commands, ran an agent')
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

  it('keeps a failed command visible on the Running agent row', () => {
    const blocks = mixedRunWithBackgroundAgent()
    const at = blocks.findIndex((block) => block.type === 'tool-result' && block.output === 'cancelled 2 jobs')
    blocks[at] = { type: 'tool-result', output: 'ssh: timed out', isError: true }
    const tree = render({ blocks, agentRuns: RUNNING })
    expect(headerText(tree)).toBe('Running agent1 failed')
  })

  it('says only the count in focus view, where the row never names what ran', () => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), focusView: true, agentRuns: RUNNING })
    expect(headerText(tree)).toBe('5 tool calls')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('keeps the label and glyph on the theme, in %s', (scheme, palette) => {
    const tree = render({ blocks: mixedRunWithBackgroundAgent(), agentRuns: RUNNING }, scheme)
    expect(flattenColor(agentLabel(tree).props.style)).toBe(palette.textSecondary)
    expect(tree.root.findByProps({ testID: 'agent-run-glyph' }).props.children.props.stroke).toBe(
      palette.textMuted
    )
  })
})
