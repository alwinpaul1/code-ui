import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { CcrEvent } from './ccr-session-api'
import { ClaudeChatLiveContext, type ClaudeChatLive } from './claude-chat-live'
import { BACKGROUND_AGENT, BACKGROUND_AGENT_LAUNCH_TEXT } from './fixtures/claude-background-agent-launch-2.1.296'
import { AGENT_CALL, SESSION, T0, agentCallEvents, ccrEvent, subagentBashCall, subagentText } from './fixtures/ccr-background-task-events-2.1.300'
import { orcaTranscriptRows, probeARecords } from './fixtures/claude-subagent-transcripts-2.1.296'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ccrSubagentMessages } from './ccr-background-tasks'
import { streamedSubagentMessages, subagentTranscriptTarget } from './mobile-subagent-transcript'
import { unionSubagentMessages } from './subagent-stream-file-union'
import { MobileNativeChatAgentToolCalls } from './MobileNativeChatAgentToolCalls'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { AgentToolCallsSlotProvider } from './native-chat-agent-tool-calls-slot'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import { peekSubagentActivityRequest, publishSubagentFeed, publishSubagentFeedWindowed, resetSubagentActivityForTests } from './subagent-activity-store'
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
  return { footer: null, working: true, runningCount: 1, sessionConnection: null, linkLive: events !== null, rateLimit: null, streamPhase: events ? 'live' : null, turnOpen: true, stream: events ? { events, accountId: 'acct', sessionId: SESSION, tasks: [] } : null }
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
  it('lists the calls the agent made under Tool calls (N) once its file has answered', () => {
    const tree = render(sheet(live(STREAM)))
    expect(peekSubagentActivityRequest()?.targets.map((target) => target.agentId)).toEqual([BACKGROUND_AGENT.agentId])
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, ccrSubagentMessages(STREAM, AGENT_CALL)))
    expect(labels(tree)).toContain('Tool calls (2)')
    expect(callRows(tree)).toHaveLength(2)
  })

  it('falls back to the agent’s file through the desktop when the stream holds none of its calls', () => {
    const tree = render(sheet(live([...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT), subagentText('Starting.', T0 + 1_000)])))
    expect(peekSubagentActivityRequest()?.targets.map((target) => target.agentId)).toEqual([BACKGROUND_AGENT.agentId])
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, orcaTranscriptRows(probeARecords())))
    // Exact: the stream's "Starting." is not in this file, but it is no call.
    expect(labels(tree)).toContain('Tool calls (4)')
  })

  it('falls back to the file with no live stream at all', () => {
    render(sheet(live(null)))
    expect(peekSubagentActivityRequest()?.targets).toHaveLength(1)
  })
})

// Review 2026-10-15: the tab's store drops undrawn events past CCR_HELD_UNDRAWN_EVENTS, and a
// subagent's own events draw nothing in the lead's chat, so a long agent keeps only its newest
// calls in the stream. Reading the stream alone, one streamed call against four in the file read
// "Tool calls (1)". The file is the baseline now, and the stream adds what the file lacks.
describe('the Agent sheet counts the agent’s calls from its file and the stream together', () => {
  const FOUR = [1, 2, 3, 4].flatMap((n) => subagentBashCall(`toolu_sub_union_${n}`, `step ${n}`, `Step ${n}`, T0 + n * 1_000))
  const FILE = () => ccrSubagentMessages([...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT), ...FOUR], AGENT_CALL)
  const withStream = (events: readonly CcrEvent[]) => live([...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT), ...events])
  const tail = (tree: ReactTestRenderer) => labels(tree).filter((label) => label.startsWith('Tool calls'))

  it('a stream that kept one of the agent’s four calls still reads Tool calls (4)', () => {
    const tree = render(sheet(withStream(FOUR.slice(-2))))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, FILE()))
    expect(tail(tree)).toEqual(['Tool calls (4)'])
    expect(callRows(tree)).toHaveLength(4)
  })

  it('a call the stream holds and the file does not yet is added to the file’s, and the count is a floor', () => {
    const fifth = subagentBashCall('toolu_sub_union_5', 'step 5', 'Step 5', T0 + 5_000)
    const tree = render(sheet(withStream([...FOUR.slice(-2), ...fifth])))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, FILE()))
    // The file is behind the stream, so it may be behind by more than the stream still holds.
    expect(tail(tree)).toEqual(['Tool calls (5+)'])
  })

  it('with the file unread or failed, the stream’s calls show and the count is a floor', () => {
    const tree = render(sheet(withStream(FOUR.slice(-2))))
    expect(tail(tree)).toEqual(['Tool calls (1+)'])
    expect(callRows(tree)).toHaveLength(1)
  })

  it('with no stream, the file’s calls are counted exactly', () => {
    const tree = render(sheet(live(null)))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, FILE()))
    expect(tail(tree)).toEqual(['Tool calls (4)'])
  })

  it('with nothing in either, no Tool calls section and View transcript stays', () => {
    const tree = render(sheet(withStream([])))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, []))
    expect(tail(tree)).toEqual([])
    expect(tree.root.findAll((n) => n.props.testID === 'agent-view-transcript' && String(n.type) === 'Pressable')).toHaveLength(1)
  })

  it('one call held by both reads Tool calls (1), not 2', () => {
    const one = subagentBashCall('toolu_sub_union_only', 'only', 'Only', T0 + 1_000)
    const tree = render(sheet(withStream(one)))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, ccrSubagentMessages(one, AGENT_CALL)))
    expect(tail(tree)).toEqual(['Tool calls (1)'])
  })

  it('a call in both under different row ids is counted once, by its tool_use id', () => {
    const file = FILE().map((message) => ({ ...message, id: `file-${message.id}` }))
    const tree = render(sheet(withStream(FOUR)))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, file))
    expect(tail(tree)).toEqual(['Tool calls (4)'])
  })
})

describe('unionSubagentMessages', () => {
  const call = (id: string, callId: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'tool-call', name: 'Bash', input: {}, callId }], timestamp: null, source: 'transcript' })
  const result = (id: string, callId: string): NativeChatMessage => ({ id, role: 'tool', blocks: [{ type: 'tool-result', output: 'ok', callId }], timestamp: null, source: 'transcript' })

  it('is empty for two empty sources', () => {
    expect(unionSubagentMessages([], [])).toEqual([])
  })

  it('keeps a lone file row and a lone streamed row', () => {
    expect(unionSubagentMessages([call('a', 'c1')], []).map((m) => m.id)).toEqual(['a'])
    expect(unionSubagentMessages([], [call('a', 'c1')]).map((m) => m.id)).toEqual(['a'])
  })

  it('drops a streamed row the file holds, by row id or by tool_use id', () => {
    expect(unionSubagentMessages([call('a', 'c1')], [call('a', 'c1'), call('b', 'c1'), call('c', 'c2')]).map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('keeps a streamed result whose call the file holds without its result yet', () => {
    expect(unionSubagentMessages([call('a', 'c1')], [result('r', 'c1')]).map((m) => m.id)).toEqual(['a', 'r'])
  })
})

// Review 2026-10-15 (probes against 98c7d13ab). The union returned `[...file, ...extra]`: the file
// feed reads only the newest 40 messages (INITIAL_LIMIT, use-mobile-native-chat-session.ts), so a
// stream holding older calls put them after the file's newer ones, a call whose result opened the
// file's window was counted twice, a thinking line drawn by both decoders showed twice, an empty
// file answer read as an exact count, and a stream row with no uuid was drawn beside the file's copy.
describe('the Agent sheet orders and counts the file’s window and the stream together', () => {
  const tail = (tree: ReactTestRenderer) => labels(tree).filter((label) => label.startsWith('Tool calls'))
  const steps = (tree: ReactTestRenderer) => callRows(tree).map((row) => /step \d/i.exec(textOf(row))?.[0].toLowerCase() ?? '?')
  const commands = (messages: readonly NativeChatMessage[]) =>
    messages.flatMap((message) => message.blocks.flatMap((block) => (block.type === 'tool-call' ? [String((block.input as { command?: unknown }).command)] : [])))
  const withStream = (events: readonly CcrEvent[]) => live([...agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT), ...events])
  const calls = (count: number) =>
    Array.from({ length: count }, (_, index) => index + 1).flatMap((n) => subagentBashCall(`toolu_sub_order_${n}`, `step ${n}`, `Step ${n}`, T0 + n * 1_000))

  it('a stream holding older calls than the file’s window lists them oldest first', () => {
    const four = calls(4)
    const file = ccrSubagentMessages(four, AGENT_CALL).slice(-4)
    expect(commands(unionSubagentMessages(file, ccrSubagentMessages(four, AGENT_CALL)))).toEqual(['step 1', 'step 2', 'step 3', 'step 4'])
    const tree = render(sheet(withStream(four)))
    act(() => {
      publishSubagentFeed(BACKGROUND_AGENT.agentId, file)
      publishSubagentFeedWindowed(BACKGROUND_AGENT.agentId, true)
    })
    expect(steps(tree)).toEqual(['step 1', 'step 2', 'step 3', 'step 4'])
    expect(tail(tree)).toEqual(['Tool calls (4+)'])
  })

  it('a call whose result opens the file’s window is counted once: three calls read (3+), not (4+)', () => {
    const three = calls(3)
    const file = ccrSubagentMessages(three, AGENT_CALL).slice(1)
    expect(file[0]!.blocks[0]!.type).toBe('tool-result')
    const tree = render(sheet(withStream(three)))
    act(() => {
      publishSubagentFeed(BACKGROUND_AGENT.agentId, file)
      publishSubagentFeedWindowed(BACKGROUND_AGENT.agentId, true)
    })
    expect(tail(tree)).toEqual(['Tool calls (3+)'])
    expect(steps(tree)).toEqual(['step 1', 'step 2', 'step 3'])
  })

  it('a stream that adds only a text row the file lacks keeps the file’s count exact', () => {
    const two = calls(2)
    const tree = render(sheet(withStream([...two, subagentText('Thinking about step 3.', T0 + 9_000)])))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, ccrSubagentMessages(two, AGENT_CALL)))
    expect(tail(tree)).toEqual(['Tool calls (2)'])
  })

  it('an empty file answer with streamed calls reads as a floor, (2+), not (2)', () => {
    const tree = render(sheet(withStream(calls(2))))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, []))
    expect(tail(tree)).toEqual(['Tool calls (2+)'])
  })

  it('with the file read failed, the stream’s calls are drawn in order and counted as a floor', () => {
    const tree = render(sheet(withStream(calls(3))))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, ccrSubagentMessages(calls(1), AGENT_CALL)))
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, null))
    expect(steps(tree)).toEqual(['step 1', 'step 2', 'step 3'])
    expect(tail(tree)).toEqual(['Tool calls (3+)'])
  })
})

describe('unionSubagentMessages orders and de-duplicates the two sources', () => {
  const row = (id: string, timestamp: number | null, blocks: NativeChatMessage['blocks'], role: NativeChatMessage['role'] = 'assistant'): NativeChatMessage => ({
    id,
    role,
    blocks,
    timestamp,
    source: 'transcript'
  })
  const text = (id: string, timestamp: number | null) => row(id, timestamp, [{ type: 'text', text: id }])
  const ids = (messages: readonly NativeChatMessage[]) => messages.map((message) => message.id)

  it('puts one older streamed row before one file row', () => {
    expect(ids(unionSubagentMessages([text('f', T0 + 2_000)], [text('s', T0 + 1_000)]))).toEqual(['s', 'f'])
  })

  it('keeps the file’s order on a timestamp tie', () => {
    expect(ids(unionSubagentMessages([text('f1', T0), text('f2', T0)], [text('s', T0)]))).toEqual(['f1', 'f2', 's'])
  })

  it('keeps a row with no timestamp next to the row before it in its own source', () => {
    expect(ids(unionSubagentMessages([text('a', null), text('b', T0 + 2_000)], [text('c', T0 + 1_000), text('d', null)]))).toEqual(['a', 'c', 'd', 'b'])
  })

  it('puts a streamed call before the file’s result for it, even when the stream’s clock reads later', () => {
    const merged = unionSubagentMessages(
      [row('r1', T0 + 2_000, [{ type: 'tool-result', callId: 'c1', output: 'ok' }], 'tool'), text('f', T0 + 2_500)],
      [row('call1', T0 + 3_000, [{ type: 'tool-call', name: 'Bash', input: {}, callId: 'c1' }])]
    )
    expect(ids(merged)).toEqual(['call1', 'r1', 'f'])
  })

  it('draws a thinking line once when Orca keys it by uuid and the stream by uuid:thinking', () => {
    const thinking = ccrEvent({ type: 'assistant', parent_tool_use_id: AGENT_CALL, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Weighing the parser.' }] } }, T0 + 1_000)
    const uuid = String(thinking.payload.uuid)
    const streamed = ccrSubagentMessages([thinking], AGENT_CALL)
    expect(ids(streamed)).toEqual([`${uuid}:thinking`])
    const file = [row(uuid, T0 + 1_000, [{ type: 'text', text: 'Weighing the parser.' }], 'reasoning')]
    expect(ids(unionSubagentMessages(file, streamed))).toEqual([uuid])
  })

  it('drops a streamed text row with no uuid that the file holds with the same text, role and time', () => {
    const event = ccrEvent({ type: 'assistant', uuid: undefined, parent_tool_use_id: AGENT_CALL, message: { role: 'assistant', content: [{ type: 'text', text: 'Two failures.' }] } }, T0 + 1_000)
    const streamed = ccrSubagentMessages([event], AGENT_CALL)
    expect(ids(streamed)).toEqual([event.eventId])
    const file = [row('line-uuid', T0 + 1_000, [{ type: 'text', text: 'Two failures.' }])]
    expect(ids(unionSubagentMessages(file, streamed))).toEqual(['line-uuid'])
    // Narrow: at another time, or a streamed row that carries its uuid, it is kept.
    expect(ids(unionSubagentMessages([row('line-uuid', T0 + 9_000, [{ type: 'text', text: 'Two failures.' }])], streamed))).toEqual([event.eventId, 'line-uuid'])
    const keyed = ccrSubagentMessages([subagentText('Two failures.', T0 + 1_000)], AGENT_CALL)
    expect(unionSubagentMessages(file, keyed)).toHaveLength(2)
  })
})

describe('View transcript from the Agent sheet', () => {
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
