import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import type { NativeChatBlock, NativeChatMessage, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { claudeToolRunPalette } from '../theme/claude-tool-run-palette'
import { fontFamily, type } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { TOOL_RUN_ROW } from './claude-tool-run-row-spec'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import { MobileNativeChatAgentRun } from './MobileNativeChatAgentRun'
import { MobileNativeChatReasoningNote } from './MobileNativeChatReasoningNote'
import { ToolRun } from './MobileNativeChatToolRun'
import { NativeChatAgentRunsContext } from './native-chat-tasks-context'

// The user, 2026-10-16, side by side with the Claude Android app: "Even Ran commands and that
// things running agents we need their font sizes too from claude app into codeui". The app sets
// every collapsed step row ("Ran 5 commands, read a file ›", "Running ›", "Running agent: … ›",
// "Ran 3 agents ›", "Thought process ›") in `xo7.C`, 15 sp on a 21 sp line, in its muted ink,
// with a 16 dp chevron 4 dp after the words (claude-tool-run-row-spec.ts has the decompiled
// lines). Ours drew 13 sp Medium in `textSecondary` with a 14 dp chevron 8 dp away.

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
    React.createElement('Text', props, children as ReactNode)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        setValue(): void {}
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34, select: (options: Record<string, unknown>) => options.android },
    Pressable: 'Pressable',
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    Text,
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('./MobileNativeChatThinkingSheet', () => ({
  MobileNativeChatThinkingSheet: () => null,
  THOUGHT_PROCESS_LABEL: 'Thought process'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

const TWO_COMMANDS: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' }, state: 'completed' },
  { type: 'tool-result', output: 'a' },
  { type: 'tool-call', name: 'Bash', input: { command: 'pwd' }, state: 'completed' },
  { type: 'tool-result', output: '/' }
]
const RUNNING_BASH: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'running' }
]
const AGENT_CALL: NativeChatBlock = {
  type: 'tool-call',
  name: 'Agent',
  input: { description: 'Locate footer and queue card components', prompt: 'Find them', subagent_type: 'Explore' },
  state: 'completed'
}
const FINISHED_AGENTS: NativeChatBlock[] = [
  AGENT_CALL,
  { type: 'tool-result', output: 'Found them.' },
  { ...AGENT_CALL, input: { description: 'Read the footer', prompt: 'Read it' } },
  { type: 'tool-result', output: 'Read it.' }
]
const LAUNCHING_AGENT: NativeChatBlock[] = [{ ...AGENT_CALL, state: 'running' }]
const THOUGHT: NativeChatMessage = {
  id: 'r1',
  role: 'reasoning',
  blocks: [{ type: 'text', text: 'Check the footer before the queue card.' }],
  timestamp: null,
  source: 'transcript'
}

function Run({ blocks, activeCall }: { blocks: NativeChatBlock[]; activeCall: NativeChatToolCallBlock | null }) {
  return createElement(ToolRun, { blocks, defaultExpanded: false, activeCall, styles: useChatMessageStyles() })
}
function Agents({ blocks }: { blocks: NativeChatBlock[] }) {
  return createElement(MobileNativeChatAgentRun, { blocks, styles: useChatMessageStyles() })
}
function Thought() {
  return createElement(MobileNativeChatReasoningNote, { message: THOUGHT, fontScale: 1, styles: useChatMessageStyles() })
}

/** A live turn, so an Agent call with no answer yet reads as "Running agent". */
const TURN_WORKING = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }

const SCHEMES = ['light', 'dark'] as const

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(6).filter((entry) => entry && typeof entry === 'object'))

describe('the collapsed step rows, set as the Claude app sets them', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(node: ReactNode, scheme: 'light' | 'dark'): ReactTestInstance {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <NativeChatAgentRunsContext.Provider value={TURN_WORKING}>
            {node}
          </NativeChatAgentRunsContext.Provider>
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  const byTestId = (root: ReactTestInstance, testID: string) =>
    root.find((node) => node.props.testID === testID && String(node.type) === 'Text')
  const labelOf = (root: ReactTestInstance, words: string) =>
    root.find((node) => String(node.type) === 'Text' && [node.props.children].flat().join('') === words)

  const rows: [string, (root: ReactTestInstance) => ReactTestInstance, () => ReactNode][] = [
    ['"Ran 2 commands"', (root) => byTestId(root, 'tool-run-sentence'), () => <Run blocks={TWO_COMMANDS} activeCall={null} />],
    [
      '"Running"',
      (root) => byTestId(root, 'tool-run-active-label'),
      () => <Run blocks={RUNNING_BASH} activeCall={selectActiveToolCall(RUNNING_BASH, { activeTurnIsWorking: true })} />
    ],
    ['"Running agent"', (root) => byTestId(root, 'agent-run-label'), () => <Agents blocks={LAUNCHING_AGENT} />],
    ['"Ran 2 agents"', (root) => byTestId(root, 'agent-run-label'), () => <Agents blocks={FINISHED_AGENTS} />],
    ['"Thought process"', (root) => labelOf(root, 'Thought process'), () => <Thought />]
  ]

  for (const scheme of SCHEMES) {
    for (const [name, label, row] of rows) {
      it(`sets ${name} at 15 on 21 in SemiBold and the app's muted ink, in ${scheme}`, () => {
        const root = mount(row(), scheme)
        const style = flat(label(root).props.style)
        expect(style.fontFamily).toBe(fontFamily.semibold)
        expect(style.fontSize).toBe(type.body.size)
        expect(style.lineHeight).toBe(type.body.lineHeight)
        expect(style.color).toBe(claudeToolRunPalette(scheme).text)
      })

      it(`draws ${name}'s chevron at 16 in the words' ink, 4 after them, in ${scheme}`, () => {
        const root = mount(row(), scheme)
        const chevron = root.find((node) => String(node.type) === 'ChevronRight')
        expect(chevron.props.size).toBe(TOOL_RUN_ROW.chevronSize)
        expect(chevron.props.color).toBe(claudeToolRunPalette(scheme).text)
        const toggle = flat(chevron.parent!.props.style)
        expect(toggle.gap).toBe(4)
        expect(toggle.paddingVertical).toBe(6)
      })
    }

    it(`draws the thought row's icon at 20 in the words' ink, in ${scheme}`, () => {
      const root = mount(<Thought />, scheme)
      const brain = root.find((node) => String(node.type) === 'Brain')
      expect(brain.props.size).toBe(TOOL_RUN_ROW.thoughtIconSize)
      expect(brain.props.color).toBe(claudeToolRunPalette(scheme).text)
    })

    it(`draws the running agent's diamond in a 24 box, nudged 2 left, in ${scheme}`, () => {
      const root = mount(<AgentRunGlyph icon="agent" color={claudeToolRunPalette(scheme).icon} />, scheme)
      const svg = root.find((node) => String(node.type) === 'Svg')
      expect(svg.props.width).toBe(24)
      expect(svg.props.height).toBe(24)
      expect(svg.props.viewBox).toBe('0 0 1000 1000')
      expect(flat(svg.props.style).transform).toEqual([{ translateX: -2 }])
    })
  }

  it("takes the app's muted ink for the words and #898781 for a running row's icon", () => {
    expect([claudeToolRunPalette('light').text, claudeToolRunPalette('dark').text]).toEqual(['#7B7974', '#97958D'])
    expect([claudeToolRunPalette('light').icon, claudeToolRunPalette('dark').icon]).toEqual(['#898781', '#898781'])
  })
})
