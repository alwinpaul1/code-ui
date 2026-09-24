import { createElement, type ReactNode } from 'react'
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
    ['ChevronDown', 'ChevronRight', 'Copy', 'Image', 'ListTodo', 'SquareChevronRight', 'SquareTerminal', 'Wrench', 'X', 'Undo2', 'Sparkles', 'AlertCircle', 'AlertTriangle', 'Info', 'ArrowUp'].map((name) => [name, name])
  )
)
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null
}))
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
  for (const node of renderer.root.findAllByType('Text')) {
    for (const child of [node.props.children].flat()) {
      if (typeof child === 'string') {
        out.push(child)
      }
    }
  }
  return out
}

function colorsOf(renderer: ReactTestRenderer): string[] {
  const out: string[] = []
  for (const node of renderer.root.findAll((n) => typeof n.props.color === 'string')) {
    out.push(node.props.color)
  }
  for (const node of renderer.root.findAllByType('Text')) {
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
        createElement(
          ThemeProvider,
          { initialPreference: args.scheme ?? 'light' },
          createElement(
            MobileNativeChatTasksProvider,
            {
              messages: parallelAgentMessages(),
              agent: 'claude',
              agentWorking: args.agentWorking,
              agentStatus: args.status
            },
            createElement(MobileNativeChatMessage, { message: turn() })
          )
        )
      )
    })
    return renderer!
  }

  async function press(tree: ReactTestRenderer, label: RegExp | string) {
    const target = tree.root.findAll(
      (node) =>
        node.type === 'Pressable' &&
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
    expect(texts(tree)).toContain('Running agent')
    expect(texts(tree)).not.toContain('Ran 5 agents')
  })

  it('settles to "Ran 5 agents" once the roster holds none of them', async () => {
    const tree = await render({ status: statusWith([]), agentWorking: true })
    expect(texts(tree)).toContain('Ran 5 agents')
    expect(texts(tree)).not.toContain('Running agent')
  })

  it('opens a "Ran 5 agents" sheet listing each agent by its description', async () => {
    const tree = await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true })
    expect(tree.root.findAll((node) => node.props.testID === 'agent-run-sheet')).toHaveLength(0)
    await press(tree, /Show the agents/)
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

  it('paints from the theme in light and dark', async () => {
    const light = colorsOf(await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true, scheme: 'light' }))
    act(() => renderer?.unmount())
    const dark = colorsOf(await render({ status: statusWith(PARALLEL_AGENTS), agentWorking: true, scheme: 'dark' }))
    expect(light).toContain(lightColors.textMuted)
    expect(dark).toContain(darkColors.textMuted)
    expect(dark).not.toContain(lightColors.textMuted)
  })
})
