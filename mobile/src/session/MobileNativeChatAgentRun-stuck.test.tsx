import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { claudeToolRunPalette } from '../theme/claude-tool-run-palette'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'
import { resetSubagentTranscriptForTests } from './subagent-transcript-store'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { BACKGROUND_AGENT, backgroundAgentLaunchMessages } from './fixtures/claude-background-agent-launch-2.1.296'

vi.mock('react-native', () => ({
  Animated: {
    Text: 'Text',
    View: 'View',
    Value: class {
      setValue(): void {}
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    sequence: () => ({}),
    timing: () => ({})
  },
  Image: 'Image',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['ChevronDown', 'ChevronRight', 'Copy', 'Image', 'ListTodo', 'Eye', 'Globe', 'MessageSquare', 'Pencil', 'Search', 'SquareChevronRight', 'SquareTerminal', 'TextCursorInput', 'Wrench', 'X', 'Undo2', 'Sparkles', 'AlertCircle', 'AlertTriangle', 'Info', 'ArrowUp', 'Briefcase', 'FileText', 'TriangleAlert'].map((name) => [name, name])
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
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return {
    MobileMarkdown: ({ content }: { content: string }) => React.createElement('Text', null, content)
  }
})

// "Running an Agent animation gets stuck" (the user, 2026-10-11, watching the
// hand-started session 0954729d on the phone). The row of a background Agent
// call kept sweeping "Running agent: Commands sheet like Claude" after its
// launch result was in and the turn had ended, for as long as anything counted
// the agent as running. On a hand-started tab nothing ever stopped counting it:
// the agent's completion was absorbed mid-turn, a record Orca's reader drops.

const PARENT = '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/0954729d-6205-4368-8185-7c630268f2d0.jsonl'

/** Orca's hook status for the pane with the agent still on its roster. */
function rosterRunningTheAgent(): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 0,
    stateStartedAt: 0,
    providerSession: { transcriptPath: PARENT },
    subagents: [
      {
        id: BACKGROUND_AGENT.agentId,
        description: BACKGROUND_AGENT.description,
        state: 'working' as const,
        startedAt: Date.parse(BACKGROUND_AGENT.calledAt)
      }
    ]
  } as AgentStatusEntry
}

function texts(renderer: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of renderer.root.findAllByType('Text' as never)) {
    for (const child of [node.props.children].flat()) {
      if (typeof child === 'string') {
        out.push(child)
      }
    }
  }
  return out
}

function labelNode(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => node.props.testID === 'agent-run-label' && String(node.type) === 'Text')
}

/** The label's glyphs while it shimmers: one span per character. */
function glyphsOf(renderer: ReactTestRenderer): string[] {
  return labelNode(renderer)
    .findAll((node) => String(node.type) === 'Text' && node !== labelNode(renderer))
    .map((node) => String(node.props.children))
}

function labelText(renderer: ReactTestRenderer): string {
  const children = labelNode(renderer).props.children
  return typeof children === 'string' ? children : glyphsOf(renderer).join('')
}

function colorsOf(renderer: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of renderer.root.findAll((n) => typeof n.props.color === 'string')) {
    out.push(node.props.color)
  }
  return out
}

describe('the row of a background Agent call (session 0954729d, Claude Code 2.1.296)', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetSubagentTranscriptForTests()
  })

  async function render(args: {
    messages: NativeChatMessage[]
    status: AgentStatusEntry | null
    agentWorking: boolean
    scheme?: 'light' | 'dark'
  }) {
    const turn = foldMobileNativeChatMessages(args.messages).find((message) =>
      message.blocks.some((block) => block.type === 'tool-call')
    )!
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={args.scheme ?? 'light'}>
          <MobileNativeChatTasksProvider
            messages={args.messages}
            agent="claude"
            agentWorking={args.agentWorking}
            agentStatus={args.status}
          >
            <MobileNativeChatMessage message={turn} />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    })
    return renderer!
  }

  // The 2026-10-11 recording (Claude Code 2.1.296): the Claude app sweeps
  // "Running agent: <description>" for as long as the background agent works.
  // Orca's roster will also say when it stops, so the row may follow it.
  it('sweeps "Running agent: <description>" after the launch answered, while Orca\'s roster lists the agent', async () => {
    const tree = await render({ messages: backgroundAgentLaunchMessages(), status: rosterRunningTheAgent(), agentWorking: true })
    expect(glyphsOf(tree).join('')).toBe(`Running agent: ${BACKGROUND_AGENT.description}`)
  })

  it('stops sweeping and reads "Ran 1 agent" once the roster has dropped the agent', async () => {
    const tree = await render({ messages: backgroundAgentLaunchMessages(), status: { ...rosterRunningTheAgent(), subagents: [] }, agentWorking: true })
    expect(glyphsOf(tree)).toEqual([])
    expect(labelText(tree)).toBe('Ran 1 agent')
    expect(texts(tree)).not.toContain(`Running agent: ${BACKGROUND_AGENT.description}`)
  })

  it('is not left sweeping after the turn ended on a hand-started tab, where the agent\'s finish never reaches the phone', async () => {
    // No host status and no beacon: the transcript reader counts the agent as
    // running forever, because its completion was written only as a record
    // Orca's reader drops.
    const tree = await render({ messages: backgroundAgentLaunchMessages(), status: null, agentWorking: false })
    expect(glyphsOf(tree)).toEqual([])
    expect(labelText(tree)).toBe('Ran 1 agent')
  })

  // 2026-10-16, the user's screenshots of one moment: the Claude app
  // (com.anthropic.claude 1.261013.20) drew a bare "Running agent ›", no icon,
  // over an Agent call still waiting on its answer; Code UI drew the diamonds
  // and "Running agent: Port Claude app live tool row ›". The app names the
  // agent and draws its icon only from the BACKGROUND TASK the call launched
  // (ei4.java:930-1023), and a call still being made has none.
  it('reads a bare "Running agent" with no icon while the call is still being made, as the Claude app does', async () => {
    const tree = await render({
      messages: backgroundAgentLaunchMessages({ withResult: false }),
      status: rosterRunningTheAgent(),
      agentWorking: true
    })
    expect(glyphsOf(tree).join('')).toBe('Running agent')
    expect(tree.root.findAll((node) => String(node.props.testID ?? '').startsWith('agent-run-glyph'))).toEqual([])
  })

  // agentSimple (cds_icon_symbols U+E11B, one diamond) for one running agent,
  // agentsSimple (U+E11C, two) for several (ei4.java:969-994, rt30.java:473).
  it('draws the one-diamond agent icon beside "Running agent: <description>" while the launched agent runs', async () => {
    const tree = await render({ messages: backgroundAgentLaunchMessages(), status: rosterRunningTheAgent(), agentWorking: true })
    expect(tree.root.findAll((node) => node.props.testID === 'agent-run-glyph-agent' && String(node.type) === 'Svg')).toHaveLength(1)
    expect(tree.root.findAll((node) => node.props.testID === 'agent-run-glyph-agents')).toEqual([])
  })

  it('draws no icon on "Ran 1 agent"', async () => {
    const tree = await render({ messages: backgroundAgentLaunchMessages(), status: { ...rosterRunningTheAgent(), subagents: [] }, agentWorking: true })
    expect(labelText(tree)).toBe('Ran 1 agent')
    expect(tree.root.findAll((node) => String(node.props.testID ?? '').startsWith('agent-run-glyph'))).toEqual([])
  })

  it('paints the running agent icon from the theme in light and dark', async () => {
    const glyphColor = (tree: ReactTestRenderer) =>
      tree.root.find((node) => node.props.testID === 'agent-run-glyph-agent' && String(node.type) === 'Svg').findByType('Path' as never).props.fill
    const light = glyphColor(await render({ messages: backgroundAgentLaunchMessages(), status: rosterRunningTheAgent(), agentWorking: true, scheme: 'light' }))
    act(() => renderer?.unmount())
    const dark = glyphColor(await render({ messages: backgroundAgentLaunchMessages(), status: rosterRunningTheAgent(), agentWorking: true, scheme: 'dark' }))
    expect(light).toBe(claudeToolRunPalette('light').icon)
    expect(dark).toBe(claudeToolRunPalette('dark').icon)
  })

  it('stands still once the turn has ended with the call never answered', async () => {
    const tree = await render({
      messages: backgroundAgentLaunchMessages({ withResult: false }),
      status: rosterRunningTheAgent(),
      agentWorking: false
    })
    expect(glyphsOf(tree)).toEqual([])
    expect(labelText(tree)).toBe('Ran 1 agent')
  })

  // The sweep: the ordinary tool row of a structured turn had the same shape.
  it('draws no "Running" over a stateless structured call whose result is in, while the turn thinks on', async () => {
    const message: NativeChatMessage = {
      id: 'structured-turn',
      role: 'assistant',
      timestamp: 0,
      source: 'transcript',
      blocks: [
        { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, callId: 'c1' },
        { type: 'tool-result', output: 'ok', callId: 'c1' }
      ]
    }
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatMessage message={message} structuredActivityUi activeTurnIsWorking />
        </ThemeProvider>
      )
    })
    expect(renderer!.root.findAll((node) => node.props.testID === 'tool-run-active-label')).toEqual([])
  })

  it('paints the settled row from the theme in light and dark', async () => {
    const light = colorsOf(await render({ messages: backgroundAgentLaunchMessages(), status: null, agentWorking: false, scheme: 'light' }))
    act(() => renderer?.unmount())
    const dark = colorsOf(await render({ messages: backgroundAgentLaunchMessages(), status: null, agentWorking: false, scheme: 'dark' }))
    expect(light).toContain(claudeToolRunPalette('light').text)
    expect(dark).toContain(claudeToolRunPalette('dark').text)
    expect(dark).not.toContain(claudeToolRunPalette('light').text)
  })
})
