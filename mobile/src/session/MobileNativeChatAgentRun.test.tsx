import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'
import { peekSubagentTranscript, resetSubagentTranscriptForTests } from './subagent-transcript-store'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { PARALLEL_AGENTS, parallelAgentMessages } from './fixtures/claude-parallel-agents-2.1.281'

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
    ['ChevronDown', 'ChevronRight', 'Copy', 'Image', 'ListTodo', 'Eye', 'Globe', 'MessageSquare', 'Pencil', 'Search', 'SquareChevronRight', 'SquareTerminal', 'Wrench', 'X', 'Undo2', 'Sparkles', 'AlertCircle', 'AlertTriangle', 'Info', 'ArrowUp', 'Briefcase', 'FileText', 'TriangleAlert'].map((name) => [name, name])
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
// A row's own detail sheet needs gesture-handler; the run tests never open it.
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

const PARENT = '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d.jsonl'

/** Orca's hook status for the pane: the roster of agents still running,
 *  each with the description Claude Code gave it. */
function statusWith(running: readonly (typeof PARALLEL_AGENTS)[number][]): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 0,
    stateStartedAt: 0,
    providerSession: { transcriptPath: PARENT },
    subagents: running.map((agent) => ({
      id: agent.agentId,
      description: agent.description,
      state: 'working' as const,
      startedAt: Date.parse(agent.at)
    }))
  } as AgentStatusEntry
}

function turn(): NativeChatMessage {
  return foldMobileNativeChatMessages(parallelAgentMessages()).at(-1)!
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

/** The label as a reader sees it, whole or in glyphs. */
function labelText(renderer: ReactTestRenderer): string {
  const children = labelNode(renderer).props.children
  return typeof children === 'string' ? children : glyphsOf(renderer).join('')
}

function opacityOf(style: unknown): unknown {
  return [style].flat(3).reduce<unknown>((found, entry) => (entry as { opacity?: unknown } | null)?.opacity ?? found, undefined)
}

function colorsOf(renderer: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of renderer.root.findAll((n) => typeof n.props.color === 'string')) {
    out.push(node.props.color)
  }
  for (const node of renderer.root.findAllByType('Text' as never)) {
    for (const entry of [node.props.style].flat(3)) {
      if (entry && typeof entry.color === 'string') {
        out.push(entry.color)
      }
    }
  }
  return out
}

describe('the conversation row for five agents launched at once', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetSubagentTranscriptForTests()
  })

  async function render(args: {
    status: AgentStatusEntry | null
    agentWorking: boolean
    scheme?: 'light' | 'dark'
  }) {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={args.scheme ?? 'light'}>
          <MobileNativeChatTasksProvider
            messages={parallelAgentMessages()}
            agent="claude"
            agentWorking={args.agentWorking}
            agentStatus={args.status}
          >
            <MobileNativeChatMessage message={turn()} />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    })
    return renderer!
  }

  async function press(tree: ReactTestRenderer, label: RegExp | string) {
    const target = tree.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        typeof node.props.accessibilityLabel === 'string' &&
        (typeof label === 'string' ? node.props.accessibilityLabel === label : label.test(node.props.accessibilityLabel))
    )[0]
    if (!target) {
      throw new Error(`nothing to press labelled ${String(label)}`)
    }
    await act(async () => target.props.onPress())
  }

  it('reads "Running agent" while any of them runs, not "Ran 5 agents"', async () => {
    const tree = await render({ status: statusWith([PARALLEL_AGENTS[2]]), agentWorking: false })
    expect(labelText(tree)).toBe('Running agent')
    expect(texts(tree)).not.toContain('Ran 5 agents')
  })

  // 2026-09-26, the user, with a recording of the Claude app: "Running agents
  // animations must be like this". There the diamonds and the chevron stand
  // still and a darker band sweeps across the label; nothing fades as a whole.
  // Until then icon and label breathed together (d96fef9b).
  it('keeps the diamonds still and sweeps a shimmer across the label while an agent runs', async () => {
    const tree = await render({ status: statusWith([PARALLEL_AGENTS[2]]), agentWorking: false })
    // The Svg alone: no animated wrapper around it.
    expect(tree.root.findAll((node) => node.props.testID === 'agent-run-glyph')).toHaveLength(1)
    const row = tree.root.find(
      (node) => String(node.type) === 'Pressable' && /Show the agents/.test(String(node.props.accessibilityLabel))
    )
    expect(row.findAll((node) => opacityOf(node.props.style) !== undefined)).toEqual([])
    // The label is drawn a glyph at a time, each one coloured by the sweep.
    expect(glyphsOf(tree).join('')).toBe('Running agent')
  })

  it('draws "Ran 5 agents" whole, with nothing left sweeping, once they have all reported', async () => {
    const tree = await render({ status: statusWith([]), agentWorking: true })
    expect(glyphsOf(tree)).toEqual([])
    expect(labelText(tree)).toBe('Ran 5 agents')
  })

  it('settles to "Ran 5 agents" once the roster holds none of them', async () => {
    const tree = await render({ status: statusWith([]), agentWorking: true })
    expect(texts(tree)).toContain('Ran 5 agents')
    expect(texts(tree)).not.toContain('Running agent')
  })

  it('opens a "Ran 5 agents" sheet listing each agent by its description', async () => {
    const tree = await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true })
    expect(tree.root.findAll((node) => node.props.testID === 'run-sheet')).toHaveLength(0)
    await press(tree, /Show the agents/)
    expect(tree.root.findAll((node) => node.props.testID === 'run-sheet')).toHaveLength(1)
    const shown = texts(tree)
    expect(shown).toContain('Ran 5 agents')
    expect(shown.filter((text) => text === 'Ran agent')).toHaveLength(5)
    for (const agent of PARALLEL_AGENTS) {
      expect(shown).toContain(`  ${agent.description}`)
    }
  })

  it("opens the tapped agent's own transcript, not the one its launch result was paired with", async () => {
    const tree = await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true })
    await press(tree, /Show the agents/)
    // "Keep phone's own message copy" is the first call, but the first launch
    // result belongs to "Composer clears text and media together".
    const [keep] = PARALLEL_AGENTS
    await press(tree, `Ran agent ${keep.description}`)
    expect(peekSubagentTranscript()).toMatchObject({
      running: true,
      target: {
        agentId: keep.agentId,
        title: keep.description,
        sessionId: `agent-${keep.agentId}`
      }
    })
  })

  // 2026-09-26: the viewer's header said "Subagent · Running" from the moment it
  // opened, whatever the agent did next; the roster's word was read once, at
  // the tap. The tab's roster is the one reader of what runs, so it tells the
  // open viewer when its agent leaves (or rejoins) the running set.
  it('tells an open transcript its agent finished once the roster no longer runs it', async () => {
    const [keep, ...others] = PARALLEL_AGENTS
    const tree = await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true })
    await press(tree, /Show the agents/)
    await press(tree, `Ran agent ${keep.description}`)
    const opened = peekSubagentTranscript()
    expect(opened?.running).toBe(true)

    const withRoster = (status: AgentStatusEntry) => (
      <ThemeProvider initialPreference="light">
        <MobileNativeChatTasksProvider messages={parallelAgentMessages()} agent="claude" agentWorking agentStatus={status}>
          <MobileNativeChatMessage message={turn()} />
        </MobileNativeChatTasksProvider>
      </ThemeProvider>
    )
    await act(async () => tree.update(withRoster(statusWith(others))))
    expect(peekSubagentTranscript()?.running).toBe(false)
    // The same target, so the open viewer keeps its subscription.
    expect(peekSubagentTranscript()?.target).toBe(opened?.target)

    await act(async () => tree.update(withRoster(statusWith(PARALLEL_AGENTS))))
    expect(peekSubagentTranscript()?.running).toBe(true)
  })

  it('paints from the theme in light and dark', async () => {
    const light = colorsOf(await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true, scheme: 'light' }))
    act(() => renderer?.unmount())
    const dark = colorsOf(await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true, scheme: 'dark' }))
    expect(light).toContain(lightColors.textMuted)
    expect(dark).toContain(darkColors.textMuted)
    expect(dark).not.toContain(lightColors.textMuted)
  })
})
