import { useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { ToolRun } from './MobileNativeChatToolRun'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { peekSubagentTranscript, resetSubagentTranscriptForTests } from './subagent-transcript-store'
import {
  MIXED_RUN_AGENT_DESCRIPTION,
  MIXED_RUN_AGENT_ID,
  mixedRunWithBackgroundAgent
} from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

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
    [
      'ChevronDown', 'ChevronRight', 'Copy', 'Image', 'ListTodo', 'Eye', 'Globe', 'MessageSquare', 'Pencil',
      'Search', 'SquareChevronRight', 'SquareTerminal', 'Wrench', 'X', 'Undo2', 'Sparkles', 'AlertCircle',
      'AlertTriangle', 'Info', 'ArrowUp', 'Briefcase', 'FileText', 'TriangleAlert'
    ].map((name) => [name, name])
  )
)
// The drawer's own exit animation is not under test; its contract is that
// `onAfterClose` fires once the sheet has left, which this stand-in does the
// moment `visible` goes false.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: function MockDrawer({
    visible,
    header,
    onAfterClose,
    children
  }: {
    visible: boolean
    header?: ReactNode
    onAfterClose?: () => void
    children: ReactNode
  }) {
    const wasVisible = useRef(visible)
    useEffect(() => {
      if (wasVisible.current && !visible) {
        onAfterClose?.()
      }
      wasVisible.current = visible
    }, [visible, onAfterClose])
    return visible ? (
      <>
        {header}
        {children}
      </>
    ) : null
  }
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

const PARENT = '/home/user/.claude/projects/-repo/0f1e2d3c-aaaa-bbbb-cccc-111122223333.jsonl'

function messages(): NativeChatMessage[] {
  return [
    {
      id: 'mixed-1',
      role: 'assistant',
      timestamp: Date.parse('2026-10-01T09:00:00.000Z'),
      source: 'transcript',
      blocks: [{ type: 'text', text: 'Cancelling the old jobs and starting the diagnosis.' }, ...mixedRunWithBackgroundAgent()]
    }
  ]
}

function status(agentRunning: boolean): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 0,
    stateStartedAt: 0,
    providerSession: { transcriptPath: PARENT },
    subagents: agentRunning
      ? [
          {
            id: MIXED_RUN_AGENT_ID,
            description: MIXED_RUN_AGENT_DESCRIPTION,
            state: 'working' as const,
            startedAt: Date.parse('2026-10-01T09:00:00.000Z')
          }
        ]
      : []
  } as AgentStatusEntry
}

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

// 2026-10-01: a turn of CronDelete, three commands and a background agent.
// The Claude app drew "Running agent ›" and a sheet behind it; this runs the
// whole path through the chat's own provider.
describe('the run sheet opened from the chat', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetSubagentTranscriptForTests()
  })

  async function render(agentRunning: boolean, scheme: 'light' | 'dark' = 'light') {
    const list = messages()
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatTasksProvider messages={list} agent="claude" agentWorking={false} agentStatus={status(agentRunning)}>
            <MobileNativeChatMessage message={foldMobileNativeChatMessages(list).at(-1)!} />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const press = async (tree: ReactTestRenderer, testID: string, index = 0) =>
    act(async () => tree.root.findAll((n) => n.props.testID === testID && String(n.type) === 'Pressable')[index]!.props.onPress())
  // The run's own detail sheet comes first in the tree; the provider's, which
  // a run-sheet row opens, is rendered after the chat and comes last.
  const detailPair = (tree: ReactTestRenderer) => tree.root.findAllByType('ToolDetailSheet' as never).at(-1)!.props.pair

  it('reads Running agent on the row, then lists the five calls behind a tap', async () => {
    const tree = await render(true)
    expect(tree.root.findAll((n) => n.props.testID === 'tool-run-agent-label')).not.toHaveLength(0)
    expect(tree.root.findAll((n) => n.props.testID === 'run-sheet')).toHaveLength(0)
    await press(tree, 'tool-run-header')
    expect(tree.root.findAll((n) => n.props.testID === 'tool-line')).toHaveLength(0)
    expect(tree.root.findAll((n) => n.props.testID === 'run-sheet-row' && String(n.type) === 'Pressable')).toHaveLength(5)
    expect(texts(tree)).toContain('Used a tool, ran 3 commands, ran an agent')
    expect(texts(tree)).toContain('Used CronDelete')
  })

  it('titles the sheet in the past tense once the agent has reported, too', async () => {
    const tree = await render(false)
    expect(tree.root.findAll((n) => n.props.testID === 'tool-run-agent-label')).toHaveLength(0)
    await press(tree, 'tool-run-header')
    expect(texts(tree)).toContain('Used a tool, ran 3 commands, ran an agent')
  })

  it("closes the sheet and opens the tapped call's detail, not both at once", async () => {
    const tree = await render(true)
    await press(tree, 'tool-run-header')
    await press(tree, 'run-sheet-row', 1)
    expect(tree.root.findAll((n) => n.props.testID === 'run-sheet')).toHaveLength(0)
    expect(detailPair(tree)?.call?.name).toBe('Bash')
    expect(detailPair(tree)?.call?.input).toMatchObject({ description: 'Cancel our two pending jobs on the build host' })
  })

  it("opens the agent's own transcript from its row, with the sheet left open as before", async () => {
    const tree = await render(true)
    await press(tree, 'tool-run-header')
    await press(tree, 'run-sheet-row', 4)
    expect(peekSubagentTranscript()).toMatchObject({
      running: true,
      target: { agentId: MIXED_RUN_AGENT_ID, title: MIXED_RUN_AGENT_DESCRIPTION }
    })
    expect(detailPair(tree)).toBeNull()
  })

  // Review of feat/tool-run-sheet: the provider kept the blocks of the tap, so a
  // run that grew under its open sheet (another call in the same turn) was not
  // shown.
  it('shows a call that joins the run while its sheet is open', async () => {
    const tree = await render(true)
    await press(tree, 'tool-run-header')
    const rows = () => tree.root.findAll((n) => n.props.testID === 'run-sheet-row' && String(n.type) === 'Pressable')
    expect(rows()).toHaveLength(5)
    const grown = messages()
    grown[0]!.blocks.push(
      { type: 'tool-call', name: 'Read', input: { file_path: '/repo/late.ts' } },
      { type: 'tool-result', output: 'x' }
    )
    await act(async () =>
      tree.update(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatTasksProvider messages={grown} agent="claude" agentWorking={false} agentStatus={status(true)}>
            <MobileNativeChatMessage message={foldMobileNativeChatMessages(grown).at(-1)!} />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    )
    expect(rows()).toHaveLength(6)
    expect(texts(tree)).toContain('late.ts')
  })

  // The screenshot's own sequence: commands first, then an Agent. The run's row
  // was remounted when it gained its first agent call, so the sheet stopped
  // following it.
  it.each([
    ['an Agent call', { type: 'tool-call', name: 'Agent', input: { description: 'Look into it' } }],
    ['a Bash call', { type: 'tool-call', name: 'Bash', input: { command: 'pwd', description: 'Print the directory' } }]
  ] as const)('follows a run of commands that gains %s while its sheet is open', async (_name, call) => {
    const commands = (): NativeChatMessage[] => [
      {
        id: 'cmds-1',
        role: 'assistant',
        timestamp: 1,
        source: 'transcript',
        blocks: [
          { type: 'text', text: 'Working.' },
          { type: 'tool-call', name: 'Bash', input: { command: 'ls', description: 'List' } },
          { type: 'tool-result', output: 'a' },
          { type: 'tool-call', name: 'Bash', input: { command: 'pwd', description: 'Where' } },
          { type: 'tool-result', output: 'b' }
        ]
      }
    ]
    const view = (list: NativeChatMessage[]) => (
      <ThemeProvider initialPreference="light">
        <MobileNativeChatTasksProvider messages={list} agent="claude" agentWorking={false} agentStatus={status(false)}>
          <MobileNativeChatMessage message={foldMobileNativeChatMessages(list).at(-1)!} />
        </MobileNativeChatTasksProvider>
      </ThemeProvider>
    )
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(view(commands()))
    })
    await press(tree, 'tool-run-header')
    const rows = () => tree.root.findAll((n) => n.props.testID === 'run-sheet-row' && String(n.type) === 'Pressable')
    expect(rows()).toHaveLength(2)
    const grown = commands()
    grown[0]!.blocks.push(call, { type: 'tool-result', output: 'ok' })
    await act(async () => tree.update(view(grown)))
    expect(rows()).toHaveLength(3)
    act(() => tree.unmount())
  })

  // FlashList recycles a cell: the same ToolRun instance is handed another
  // message's run (a different revertScope, `${message.id}:${segmentIndex}`).
  it('keeps its sheet on the run it opened when the row is recycled to another message', async () => {
    const otherBlocks: NativeChatBlock[] = ['a', 'b', 'c'].flatMap((name) => [
      { type: 'tool-call' as const, name: 'Read', input: { file_path: `/repo/${name}.ts` } },
      { type: 'tool-result' as const, output: 'x' }
    ])
    function Row({ blocks, scope }: { blocks: NativeChatBlock[]; scope: string }) {
      const styles = useChatMessageStyles()
      return <ToolRun blocks={blocks} defaultExpanded={false} revertScope={scope} styles={styles} />
    }
    const view = (blocks: NativeChatBlock[], scope: string) => (
      <ThemeProvider initialPreference="light">
        <MobileNativeChatTasksProvider messages={[]} agent="claude" agentWorking={false} agentStatus={status(false)}>
          <Row blocks={blocks} scope={scope} />
        </MobileNativeChatTasksProvider>
      </ThemeProvider>
    )
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(view(otherBlocks.slice(0, 4), 'message-a:1'))
    })
    await press(tree, 'tool-run-header')
    const rows = () => tree.root.findAll((n) => n.props.testID === 'run-sheet-row' && String(n.type) === 'Pressable')
    expect(rows()).toHaveLength(2)
    await act(async () => tree.update(view(otherBlocks, 'message-b:1')))
    expect(rows()).toHaveLength(2)
    act(() => tree.unmount())
  })

  it('opens no detail when the sheet is dismissed without a choice', async () => {
    const tree = await render(true)
    await press(tree, 'tool-run-header')
    await act(async () =>
      tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === 'Close').props.onPress()
    )
    expect(detailPair(tree)).toBeNull()
  })
})
