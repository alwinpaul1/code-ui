import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { BACKGROUND_AGENT, BACKGROUND_AGENT_LAUNCH_TEXT } from './fixtures/claude-background-agent-launch-2.1.296'
import { orcaTranscriptRows, probeARecords } from './fixtures/claude-subagent-transcripts-2.1.296'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { MobileNativeChatAgentToolCalls } from './MobileNativeChatAgentToolCalls'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { AgentToolCallsSlotProvider } from './native-chat-agent-tool-calls-slot'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import { peekSubagentActivityRequest, publishSubagentFeed, resetSubagentActivityForTests } from './subagent-activity-store'
import { peekSubagentTranscript, resetSubagentTranscriptForTests } from './subagent-transcript-store'

// Parity gap G29: in the Claude app, an agent's "View transcript" and its run
// row open that Agent call's own sheet: its prompt, then "Tool calls (N)" with
// one row per call the agent made (1.261009.20, `y030.A`, `fe2`). The phone
// reads the agent's calls from its own transcript, through the same feed the
// Background tasks sheet uses (`subagent-activity-store.ts`), and keeps its
// full transcript viewer one tap further, behind "View transcript".
//
// The launch is the real 2.1.296 one (claude-background-agent-launch-2.1.296.ts);
// the transcript fed in is Sleep probe A's real one (claude-subagent-transcripts-2.1.296.ts),
// published under the launched agent's id: the two come from different
// sessions, which the sheet cannot tell and does not need to.

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

const AGENT_RUNS: NativeChatAgentRuns = {
  runningIds: new Set(),
  confirmed: new Map(),
  agentWorking: false,
  transcriptTarget: (agentId, title) =>
    subagentTranscriptTarget({ agent: 'claude', task: { id: agentId, kind: 'agent', title }, parentTranscriptPath: PARENT })
}

const LAUNCH: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'Agent',
    input: { description: BACKGROUND_AGENT.description, prompt: 'Make the grouped-commands sheet match Claude’s.', run_in_background: 'true' }
  },
  result: { type: 'tool-result', output: BACKGROUND_AGENT_LAUNCH_TEXT }
}

function renderTree(children: ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  return node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}

function flat(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  const entries = (Array.isArray(style) ? style.flat() : [style]) as (Record<string, unknown> | null | undefined)[]
  return Object.assign({}, ...entries.filter(Boolean))
}

const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as never).map((n) => textOf(n))
const labels = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.props.testID === 'tool-detail-section-label' && String(n.type) === 'Text').map((n) => textOf(n))
const callRows = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.props.testID === 'agent-tool-call-row' && typeof n.type === 'string')

function sheet(agentId: string | null, runs: NativeChatAgentRuns = AGENT_RUNS) {
  return (
    <AgentToolCallsSlotProvider render={(props) => <MobileNativeChatAgentToolCalls {...props} />}>
      <NativeChatAgentRunsContext.Provider value={runs}>
        <ToolDetailBody pair={LAUNCH} agentId={agentId} />
      </NativeChatAgentRunsContext.Provider>
    </AgentToolCallsSlotProvider>
  )
}

describe("an agent's own sheet lists the calls it made, as the Claude app's does", () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    resetSubagentActivityForTests()
    resetSubagentTranscriptForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it("asks for the agent's transcript while open, and lists its calls under Tool calls (N)", () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId))
    expect(peekSubagentActivityRequest()?.targets.map((target) => target.agentId)).toEqual([BACKGROUND_AGENT.agentId])
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, orcaTranscriptRows(probeARecords())))
    expect(labels(renderer)).toContain('Tool calls (4)')
    expect(callRows(renderer)).toHaveLength(4)
    expect(texts(renderer)).toContain('Start a 120-second background sleep')
  })

  it("stops asking once the sheet goes", () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId))
    act(() => renderer?.unmount())
    renderer = null
    expect(peekSubagentActivityRequest()).toBeNull()
  })

  it('opens the full transcript from View transcript', () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId))
    const link = renderer.root.find((n) => n.props.testID === 'agent-view-transcript' && String(n.type) === 'Pressable')
    act(() => {
      ;(link.props.onPress as () => void)()
    })
    expect(peekSubagentTranscript()?.target.agentId).toBe(BACKGROUND_AGENT.agentId)
    expect(peekSubagentTranscript()?.target.title).toBe(BACKGROUND_AGENT.description)
  })

  it("draws no launch acknowledgement: Claude Code marks it internal metadata, never to be quoted", () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId))
    expect(texts(renderer).join('\n')).not.toContain('Async agent launched successfully')
    expect(labels(renderer)).not.toContain('Output')
  })

  it('lists nothing until the transcript has come, and nothing for an agent it read no calls from', () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId))
    expect(labels(renderer).some((label) => label.startsWith('Tool calls'))).toBe(false)
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, orcaTranscriptRows(probeARecords().slice(0, 1))))
    expect(labels(renderer).some((label) => label.startsWith('Tool calls'))).toBe(false)
  })

  it('asks for nothing, and offers no transcript, where the agent is not known', () => {
    renderer = renderTree(sheet(null))
    expect(peekSubagentActivityRequest()).toBeNull()
    expect(renderer.root.findAll((n) => n.props.testID === 'agent-view-transcript')).toHaveLength(0)
  })

  it('asks for nothing on a tab with no subagent transcripts (Codex)', () => {
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId, { runningIds: new Set(), confirmed: new Map(), agentWorking: false }))
    expect(peekSubagentActivityRequest()).toBeNull()
  })

  it.each(['light', 'dark'] as const)('heads the list in the muted ink and draws the link in the accent ink (%s)', (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    renderer = renderTree(sheet(BACKGROUND_AGENT.agentId), scheme)
    act(() => publishSubagentFeed(BACKGROUND_AGENT.agentId, orcaTranscriptRows(probeARecords())))
    const heading = renderer.root.find((n) => n.props.testID === 'tool-detail-section-label' && String(n.type) === 'Text' && textOf(n).startsWith('Tool calls'))
    expect(flat(heading).color).toBe(colors.textMuted)
    const link = renderer.root.find((n) => n.props.testID === 'agent-view-transcript-label' && String(n.type) === 'Text')
    expect(flat(link).color).toBe(colors.accentText)
  })
})
