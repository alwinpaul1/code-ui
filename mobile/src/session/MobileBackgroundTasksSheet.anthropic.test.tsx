// The Background tasks sheet as the Claude app's, on a Claude tab whose Anthropic stream is live
// (the user, 2026-10-15, with screenshots of the Claude Android app 1.261013.20: "in the background
// task sheet, same like Claude Mobile … when I click view transcript, build that also same like
// Claude Mobile"; and the running tasks in Claude and Code UI must be the same). The list is the
// app's, from Anthropic's task events; a running row carries the app's Stop; an agent row carries
// "View transcript", which pushes the Agent call's page into the same sheet with a back arrow.
// Events: Claude Code 2.1.300's own shapes (fixtures/ccr-background-task-events-2.1.300.ts).

import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { decodeCcrEvents } from './ccr-transcript-decode'
import type { CcrEvent } from './ccr-session-api'
import { ClaudeChatLiveContext, type ClaudeChatLive } from './claude-chat-live'
import { BACKGROUND_AGENT, BACKGROUND_AGENT_LAUNCH_TEXT } from './fixtures/claude-background-agent-launch-2.1.296'
import {
  AGENT_CALL,
  SHELL_ID,
  T0,
  agentAndShellStarted,
  agentCallEvents,
  subagentBashCall,
  taskNotification
} from './fixtures/ccr-background-task-events-2.1.300'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import { BACKGROUND_TASK_TRANSCRIPT_PAGE } from './MobileBackgroundTaskTranscriptPage'
import { CCR_STOP_FAILED_LINE, type CcrStopTask } from './use-ccr-background-task-lane'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
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
    [
      'Activity', 'ArrowLeft', 'Briefcase', 'ChevronDown', 'ChevronRight', 'CircleStop', 'Diamond', 'Eye', 'FileText', 'Globe', 'ListTodo',
      'ListTree', 'MessageSquare', 'Search', 'Sparkles', 'SquareCode', 'SquareTerminal', 'TextCursorInput', 'TriangleAlert', 'Wrench', 'X'
    ].map((name) => [name, name])
  )
)
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return { MobileMarkdown: (props: { content: string }) => h('MobileMarkdown', { content: props.content }) }
})
vi.mock('../components/BottomDrawer', async () => {
  const { createElement: h } = await import('react')
  return { BottomDrawer: (props: { header: ReactNode; children: ReactNode }) => h('BottomDrawer', null, props.header, props.children) }
})
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: 'DraggableDetailSheet' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))

const NOW = T0 + 600_000
const PROMPT = 'Make the grouped-commands sheet match Claude’s.'

function live(events: readonly CcrEvent[] | null): ClaudeChatLive {
  return {
    footer: null,
    working: true,
    runningCount: 2,
    sessionConnection: null,
    linkLive: events !== null,
    rateLimit: null,
    stream: events ? { events, accountId: 'acct', sessionId: 'session_01' } : null
  }
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}
const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as never).map((node) => textOf(node))
const pressable = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll((node) => String(node.type) === 'Pressable' && (node.props.accessibilityLabel === label || (node.props.accessibilityRole === 'link' && textOf(node) === label)))
const colorOf = (node: ReactTestInstance) => {
  const style = node.props.style
  return Object.assign({}, ...(Array.isArray(style) ? style.flat() : [style]).filter(Boolean)).color as string | undefined
}

/** The desktop's own transcript: a different shell, which the stream's list must not show. */
const DESKTOP_MESSAGES: NativeChatMessage[] = [
  { id: 'd1', role: 'assistant', timestamp: T0, source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'sleep 99', description: 'Desktop-only shell', run_in_background: true } }] },
  { id: 'd2', role: 'tool', timestamp: T0 + 1, source: 'transcript', blocks: [{ type: 'tool-result', output: 'Command running in background with ID: dsk1234. Output is being written to: /tmp/x' }] }
]

function render(args: { events: readonly CcrEvent[] | null; messages?: NativeChatMessage[]; scheme?: 'light' | 'dark'; stopTask?: CcrStopTask }): ReactTestRenderer {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  let renderer!: ReactTestRenderer
  const value = live(args.events)
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={args.scheme ?? 'light'}>
        <ClaudeChatLiveContext.Provider value={value}>
          <MobileBackgroundTasksSheet visible messages={args.messages ?? []} onClose={() => undefined} stopTask={args.stopTask} transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE} />
        </ClaudeChatLiveContext.Provider>
      </ThemeProvider>
    )
  })
  return renderer
}

function rerender(renderer: ReactTestRenderer, events: readonly CcrEvent[], messages: NativeChatMessage[]) {
  const value = live(events)
  act(() => {
    renderer.update(
      <ThemeProvider initialPreference="light">
        <ClaudeChatLiveContext.Provider value={value}>
          <MobileBackgroundTasksSheet visible messages={messages} onClose={() => undefined} transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE} />
        </ClaudeChatLiveContext.Provider>
      </ThemeProvider>
    )
  })
}

describe('the Background tasks sheet lists what the Claude app lists while the Anthropic stream is live', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`lists the stream's tasks, not the desktop's, with their times (${scheme})`, () => {
      renderer = render({ events: agentAndShellStarted(), messages: DESKTOP_MESSAGES, scheme })
      const shown = texts(renderer)
      expect(shown).toContain('Rerun the rpc-recording suite')
      expect(shown).toContain(BACKGROUND_AGENT.description)
      expect(shown).toContain('3m 44s')
      expect(shown).toContain('10m 0s')
      expect(shown).not.toContain('Desktop-only shell')
    })
  }

  it("falls back to the desktop's list when the stream is not live", () => {
    renderer = render({ events: null, messages: DESKTOP_MESSAGES })
    expect(texts(renderer)).toContain('Desktop-only shell')
    expect(pressable(renderer, 'Stop task')).toHaveLength(0)
  })

  it('says nothing runs, and lists no Finished, for a live stream with no task', () => {
    renderer = render({ events: [], messages: DESKTOP_MESSAGES })
    expect(texts(renderer)).toContain('Nothing running.')
    expect(texts(renderer).some((text) => text.startsWith('Finished'))).toBe(false)
  })

  it('words a stopped task as the app does: Finished, "Stopped"', () => {
    renderer = render({ events: [...agentAndShellStarted(), taskNotification({ taskId: SHELL_ID, toolUseId: 'toolu_x', status: 'killed', at: NOW })] })
    expect(texts(renderer)).toContain('Finished 1')
    expect(texts(renderer)).toContain('Stopped')
  })
})

describe("a running row's Stop sends the app's stop_task, and says when it could not", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('draws the Stop on each running row, sends it for that task, and reads "Stopping…" until the row ends', async () => {
    const stopTask = vi.fn<CcrStopTask>(async () => true)
    const events = agentAndShellStarted()
    renderer = render({ events, stopTask })
    expect(pressable(renderer, 'Stop task')).toHaveLength(2)
    await act(async () => {
      ;(pressable(renderer!, 'Stop task')[0]!.props.onPress as () => void)()
    })
    expect(stopTask).toHaveBeenCalledWith({ events, accountId: 'acct', sessionId: 'session_01' }, SHELL_ID)
    expect(texts(renderer)).toContain('Stopping…')
    expect(pressable(renderer, 'Stop task')).toHaveLength(1)
  })

  it.each(['light', 'dark'] as const)('a refused POST gives the Stop back and says "Couldn’t stop the task. Try again." in the danger ink (%s)', async (scheme) => {
    renderer = render({ events: agentAndShellStarted(), scheme, stopTask: async () => false })
    await act(async () => {
      ;(pressable(renderer!, 'Stop task')[0]!.props.onPress as () => void)()
    })
    expect(texts(renderer)).not.toContain('Stopping…')
    expect(pressable(renderer, 'Stop task')).toHaveLength(2)
    const line = renderer.root.findAllByType('Text' as never).find((node) => textOf(node) === CCR_STOP_FAILED_LINE)
    expect(line && colorOf(line)).toBe((scheme === 'light' ? lightColors : darkColors).danger)
  })

  it('draws no Stop on a finished row', () => {
    renderer = render({ events: [...agentAndShellStarted(), taskNotification({ taskId: SHELL_ID, toolUseId: 'x', status: 'completed', at: NOW }), taskNotification({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, status: 'completed', at: NOW })] })
    expect(pressable(renderer, 'Stop task')).toHaveLength(0)
  })
})

describe("an agent's View transcript opens its Agent call's page in the same sheet, as the app's does", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  const calls = agentCallEvents(BACKGROUND_AGENT_LAUNCH_TEXT, PROMPT)
  const conversation = decodeCcrEvents(calls)

  it("offers it on the agent only, and only where the agent's call is in the conversation", () => {
    renderer = render({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    expect(pressable(renderer, 'View transcript')).toHaveLength(1)
    act(() => renderer?.unmount())
    renderer = render({ events: agentAndShellStarted(), messages: [] })
    expect(pressable(renderer, 'View transcript')).toHaveLength(0)
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`pushes the page: a back arrow, "Agent" over its status, the Prompt, then its calls as they stream in (${scheme})`, () => {
      const events = [...calls, ...agentAndShellStarted(), ...subagentBashCall('toolu_sub1', 'ls', 'List the session files', T0 + 2_000)]
      renderer = render({ events, messages: conversation, scheme })
      act(() => {
        ;(pressable(renderer!, 'View transcript')[0]!.props.onPress as () => void)()
      })
      expect(pressable(renderer, 'Back')).toHaveLength(1)
      expect(pressable(renderer, 'Close')).toHaveLength(0)
      const title = renderer.root.find((node) => node.props.testID === 'task-transcript-title' && String(node.type) === 'Text')
      const status = renderer.root.find((node) => node.props.testID === 'task-transcript-status' && String(node.type) === 'Text')
      expect(textOf(title)).toBe('Agent')
      expect(textOf(status)).toBe('In progress')
      expect(colorOf(status)).toBe((scheme === 'light' ? lightColors : darkColors).textSecondary)
      expect(texts(renderer)).toContain('Prompt')
      expect(renderer.root.findAll((node) => String(node.type) === 'MobileMarkdown' && node.props.content === PROMPT)).toHaveLength(1)
      expect(texts(renderer)).toContain('Tool calls (1)')
      // The list stays mounted underneath, out of sight.
      expect(renderer.root.findAll((node) => node.props.style?.display === 'none')).toHaveLength(1)

      const more = [...events, ...subagentBashCall('toolu_sub2', 'pwd', 'Print the directory', T0 + 3_000), taskNotification({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, status: 'completed', at: NOW })]
      rerender(renderer, more, conversation)
      expect(texts(renderer)).toContain('Tool calls (2)')
      expect(textOf(renderer.root.find((node) => node.props.testID === 'task-transcript-status' && String(node.type) === 'Text'))).toBe('Completed')
    })
  }

  it('Back returns to the list', () => {
    renderer = render({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    act(() => {
      ;(pressable(renderer!, 'View transcript')[0]!.props.onPress as () => void)()
    })
    act(() => {
      ;(pressable(renderer!, 'Back')[0]!.props.onPress as () => void)()
    })
    expect(pressable(renderer, 'Close')).toHaveLength(1)
    expect(texts(renderer)).toContain('Background tasks')
    expect(renderer.root.findAll((node) => node.props.testID === 'task-transcript-title')).toHaveLength(0)
  })

  it('lists no calls for an agent that has made none yet', () => {
    renderer = render({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    act(() => {
      ;(pressable(renderer!, 'View transcript')[0]!.props.onPress as () => void)()
    })
    expect(texts(renderer)).toContain('Prompt')
    expect(texts(renderer).some((text) => text.startsWith('Tool calls'))).toBe(false)
  })
})
