import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { CcrEvent } from './ccr-session-api'
import { ClaudeChatLiveContext, type ClaudeChatLive } from './claude-chat-live'
import { BACKGROUND_AGENT, BACKGROUND_AGENT_LAUNCH_TEXT } from './fixtures/claude-background-agent-launch-2.1.296'
import { AGENT_CALL, SESSION, T0, agentCallEvents, subagentBashCall, subagentText } from './fixtures/ccr-background-task-events-2.1.300'
import { orcaTranscriptRows, probeARecords } from './fixtures/claude-subagent-transcripts-2.1.296'
import { streamedSubagentMessages, subagentTranscriptTarget } from './mobile-subagent-transcript'
import { MobileNativeChatAgentToolCalls } from './MobileNativeChatAgentToolCalls'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { AgentToolCallsSlotProvider } from './native-chat-agent-tool-calls-slot'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import { peekSubagentActivityRequest, publishSubagentFeed, resetSubagentActivityForTests } from './subagent-activity-store'
import { followSubagentTranscriptStream, peekSubagentTranscript, resetSubagentTranscriptForTests } from './subagent-transcript-store'

// G8. The Claude app keeps a subagent's own events (those whose `parent_tool_use_id` is its Agent
// call) with that call and lists them in the Agent sheet (1009 nq8.java:937-949; 1013 still keeps
// them out of the main list). The chat's Agent sheet read them only from the agent's file through
// the desktop; with Anthropic's stream live it now reads them from the stream, and falls back to
// the file when the stream holds none. The events are Claude Code 2.1.300's shapes
// (fixtures/ccr-background-task-events-2.1.300.ts, not captured live).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['Briefcase', 'ChevronRight', 'Eye', 'FileText', 'Globe', 'ListTodo', 'MessageSquare', 'Search', 'Sparkles', 'SquareTerminal', 'TextCursorInput', 'TriangleAlert', 'Wrench', 'X'].map(
      (name) => [name, name]
    )
  )
)
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return { MobileMarkdown: (props: { content: string }) => h('MobileMarkdown', { content: props.content }) }
})
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: 'DraggableDetailSheet' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))
vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react')
  const builder: unknown = new Proxy({}, { get: (_, key) => (key === 'kind' ? 'native' : () => builder) })
  return {
    Gesture: { Native: () => builder },
    GestureDetector: (props: Record<string, unknown>) => h('GestureDetector', props)
  }
})

const PARENT = '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/0954729d-6205-4368-8185-7c630268f2d0.jsonl'
const RUNS: NativeChatAgentRuns = {
  runningIds: new Set([BACKGROUND_AGENT.agentId]),
  confirmed: new Map(),
  agentWorking: true,
  transcriptTarget: (agentId, title) => subagentTranscriptTarget({ agent: 'claude', task: { id: agentId, kind: 'agent', title }, parentTranscriptPath: PARENT })
}
const PROMPT = 'Make the grouped-commands sheet match Claude’s.'
const LAUNCH: NativeChatToolPair = {
  call: { type: 'tool-call', name: 'Agent', callId: AGENT_CALL, input: { description: BACKGROUND_AGENT.description, prompt: PROMPT, run_in_background: true } },
  result: { type: 'tool-result', callId: AGENT_CALL, output: BACKGROUND_AGENT_LAUNCH_TEXT }
}

function live(events: readonly CcrEvent[] | null): ClaudeChatLive {
  return { footer: null, working: true, runningCount: 1, sessionConnection: null, linkLive: events !== null, rateLimit: null, stream: events ? { events, accountId: 'acct', sessionId: SESSION, tasks: [] } : null }
}

const STREAM: CcrEvent[] = [
  ...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT),
  ...subagentBashCall('toolu_sub_1', 'pnpm test', 'Run the suite', T0 + 1_000),
  subagentText('Two failures in the parser.', T0 + 2_000),
  ...subagentBashCall('toolu_sub_2', 'git diff', 'Show the change', T0 + 3_000)
]

function sheet(chatLive: ClaudeChatLive): ReactNode {
  return (
    <ClaudeChatLiveContext.Provider value={chatLive}>
      <AgentToolCallsSlotProvider render={(props) => <MobileNativeChatAgentToolCalls {...props} />}>
        <NativeChatAgentRunsContext.Provider value={RUNS}>
          <ToolDetailBody pair={LAUNCH} agentId={BACKGROUND_AGENT.agentId} />
        </NativeChatAgentRunsContext.Provider>
      </AgentToolCallsSlotProvider>
    </ClaudeChatLiveContext.Provider>
  )
}

let renderer: ReactTestRenderer | null = null
function render(children: ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer!
}
const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join(''))
const labels = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.props.testID === 'tool-detail-section-label' && String(n.type) === 'Text').map((n) => textOf(n))
const callRows = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.props.testID === 'agent-tool-call-row' && typeof n.type === 'string')
const flat = (node: ReactTestInstance): Record<string, unknown> => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean))
const press = (tree: ReactTestRenderer, id: string) => act(() => (tree.root.find((n) => n.props.testID === id && String(n.type) === 'Pressable').props.onPress as () => void)())

beforeEach(() => {
  resetSubagentActivityForTests()
  resetSubagentTranscriptForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the chat’s Agent sheet reads the agent’s calls from Anthropic’s stream', () => {
  it('lists the calls the agent made under Tool calls (N), without asking the desktop for its file', () => {
    const tree = render(sheet(live(STREAM)))
    expect(labels(tree)).toContain('Tool calls (2)')
    expect(callRows(tree)).toHaveLength(2)
    expect(peekSubagentActivityRequest()).toBeNull()
  })

  it('falls back to the agent’s file through the desktop when the stream holds none of its calls', () => {
    const tree = render(sheet(live([...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT), subagentText('Starting.', T0 + 1_000)])))
    expect(peekSubagentActivityRequest()?.targets.map((target) => target.agentId)).toEqual([BACKGROUND_AGENT.agentId])
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, orcaTranscriptRows(probeARecords())))
    expect(labels(tree)).toContain('Tool calls (4)')
  })

  it('falls back to the file with no live stream at all', () => {
    render(sheet(live(null)))
    expect(peekSubagentActivityRequest()?.targets).toHaveLength(1)
  })

  it('View transcript opens the agent’s rows from the stream, and they follow the stream as it grows', () => {
    const tree = render(sheet(live(STREAM)))
    press(tree, 'agent-view-transcript')
    const opened = peekSubagentTranscript()!
    expect(opened.target.agentId).toBe(BACKGROUND_AGENT.agentId)
    expect(opened.stream?.toolUseId).toBe(AGENT_CALL)
    expect(streamedSubagentMessages(opened)!.map((row) => row.role)).toEqual(['assistant', 'tool', 'assistant', 'assistant', 'tool'])
    const more = [...STREAM, subagentText('Fixed both.', T0 + 4_000)]
    followSubagentTranscriptStream(more)
    expect(streamedSubagentMessages(peekSubagentTranscript()!)!.at(-1)!.blocks).toEqual([{ type: 'text', text: 'Fixed both.' }])
  })

  it('View transcript reads the file when the stream has nothing of the agent’s', () => {
    const tree = render(sheet(live(null)))
    press(tree, 'agent-view-transcript')
    expect(peekSubagentTranscript()?.stream ?? null).toBeNull()
    expect(streamedSubagentMessages(peekSubagentTranscript()!)).toBeNull()
  })

  it('a stream that went away leaves an open viewer on what it last held', () => {
    const tree = render(sheet(live(STREAM)))
    press(tree, 'agent-view-transcript')
    followSubagentTranscriptStream(null)
    expect(streamedSubagentMessages(peekSubagentTranscript()!)).toHaveLength(5)
  })

  it.each(['light', 'dark'] as const)('heads the streamed list in the muted ink (%s)', (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    const tree = render(sheet(live(STREAM)), scheme)
    const heading = tree.root.find((n) => n.props.testID === 'tool-detail-section-label' && String(n.type) === 'Text' && textOf(n).startsWith('Tool calls'))
    expect(flat(heading).color).toBe(colors.textMuted)
  })
})
