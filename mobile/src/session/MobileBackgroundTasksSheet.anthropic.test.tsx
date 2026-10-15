// The Background tasks sheet as the Claude app's, on a Claude tab whose Anthropic stream is live
// (the user, 2026-10-15, with screenshots of the Claude Android app 1.261013.20: "in the background
// task sheet, same like Claude Mobile … when I click view transcript, build that also same like
// Claude Mobile"; and the running tasks in Claude and Code UI must be the same). The list is the
// app's, from Anthropic's task events; an agent row carries "View transcript", which pushes the
// Agent call's page into the same sheet with a back arrow. The Stop is behind a switch that is off
// until the Anthropic control lane ships; its own tests turn it on
// (MobileBackgroundTasksSheet.anthropic-stop.test.tsx).
// Events: Claude Code 2.1.300's own shapes (fixtures/ccr-background-task-events-2.1.300.ts).

import { createElement, type ReactNode } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { BACKGROUND_AGENT, BACKGROUND_AGENT_LAUNCH_TEXT } from './fixtures/claude-background-agent-launch-2.1.296'
import {
  AGENT_CALL,
  SHELL_ID,
  T0,
  agentAndShellStarted,
  agentCallEvents,
  subagentBashCall,
  subagentText,
  taskNotification
} from './fixtures/ccr-background-task-events-2.1.300'
import { DESKTOP_MESSAGES, NOW, PROMPT, colorOf, pressable, renderSheet, rerenderSheet, textOf, texts } from './MobileBackgroundTasksSheet.anthropic.test-support'
import type { AgentToolCallsProps } from './native-chat-agent-tool-calls-slot'

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

const openTranscript = (renderer: ReactTestRenderer) =>
  act(() => {
    ;(pressable(renderer, 'View transcript')[0]!.props.onPress as () => void)()
  })

describe('the Background tasks sheet lists what the Claude app lists while the Anthropic stream is live', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`lists the stream's tasks, not the desktop's, with their times (${scheme})`, () => {
      renderer = renderSheet({ events: agentAndShellStarted(), messages: DESKTOP_MESSAGES, scheme })
      const shown = texts(renderer)
      expect(shown).toContain('Rerun the rpc-recording suite')
      expect(shown).toContain(BACKGROUND_AGENT.description)
      expect(shown).toContain('3m 44s')
      expect(shown).toContain('10m 0s')
      expect(shown).not.toContain('Desktop-only shell')
    })
  }

  it("falls back to the desktop's list when the stream is not live", () => {
    renderer = renderSheet({ events: null, messages: DESKTOP_MESSAGES })
    expect(texts(renderer)).toContain('Desktop-only shell')
    expect(pressable(renderer, 'Stop task')).toHaveLength(0)
  })

  it('says nothing runs, and lists no Finished, for a live stream with no task', () => {
    renderer = renderSheet({ events: [], messages: DESKTOP_MESSAGES })
    expect(texts(renderer)).toContain('Nothing running.')
    expect(texts(renderer).some((text) => text.startsWith('Finished'))).toBe(false)
  })

  it('words a stopped task as the app does: Finished, "Stopped"', () => {
    renderer = renderSheet({ events: [...agentAndShellStarted(), taskNotification({ taskId: SHELL_ID, toolUseId: 'toolu_x', status: 'killed', at: NOW })] })
    expect(texts(renderer)).toContain('Finished 1')
    expect(texts(renderer)).toContain('Stopped')
  })

  it("draws no Stop on Anthropic's rows while the stop_task switch is off", () => {
    const stopTask = vi.fn(async () => true)
    renderer = renderSheet({ events: agentAndShellStarted(), stopTask })
    expect(texts(renderer)).toContain('Rerun the rpc-recording suite')
    expect(pressable(renderer, 'Stop task')).toHaveLength(0)
    expect(stopTask).not.toHaveBeenCalled()
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
    renderer = renderSheet({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    expect(pressable(renderer, 'View transcript')).toHaveLength(1)
    act(() => renderer?.unmount())
    renderer = renderSheet({ events: agentAndShellStarted(), messages: [] })
    expect(pressable(renderer, 'View transcript')).toHaveLength(0)
  })

  // The desktop's rows have offered no link since 2026-10-10; the page is the Anthropic lane's.
  for (const withLive of [false, true] as const) {
    it(`offers no View transcript on the desktop's agent rows when the stream is not live (${withLive ? 'link down' : 'no live context'})`, () => {
      renderer = renderSheet({ events: null, messages: conversation, withLive })
      expect(texts(renderer)).toContain(BACKGROUND_AGENT.description)
      expect(pressable(renderer, 'View transcript')).toHaveLength(0)
    })
  }

  for (const scheme of ['light', 'dark'] as const) {
    it(`pushes the page: a back arrow, "Agent" over its status, the Prompt, then its calls as they stream in (${scheme})`, () => {
      const events = [...calls, ...agentAndShellStarted(), ...subagentBashCall('toolu_sub1', 'ls', 'List the session files', T0 + 2_000)]
      renderer = renderSheet({ events, messages: conversation, scheme })
      openTranscript(renderer)
      expect(pressable(renderer, 'Back')).toHaveLength(1)
      expect(pressable(renderer, 'Close')).toHaveLength(0)
      const title = renderer.root.find((node) => node.props.testID === 'task-transcript-title' && String(node.type) === 'Text')
      const status = renderer.root.find((node) => node.props.testID === 'task-transcript-status' && String(node.type) === 'Text')
      expect(textOf(title)).toBe('Agent')
      expect(textOf(status)).toBe('In progress')
      expect(colorOf(status)).toBe((scheme === 'light' ? lightColors : darkColors).textSecondary)
      expect(texts(renderer)).toContain('Prompt')
      expect(renderer.root.findAll((node) => String(node.type) === 'MobileMarkdown' && node.props.content === PROMPT)).toHaveLength(1)
      // No file reader in this harness: the stream's calls alone are a floor, never an exact count.
      expect(texts(renderer)).toContain('Tool calls (1+)')
      // The list stays mounted underneath, out of sight.
      expect(renderer.root.findAll((node) => node.props.style?.display === 'none')).toHaveLength(1)

      const more = [...events, ...subagentBashCall('toolu_sub2', 'pwd', 'Print the directory', T0 + 3_000), taskNotification({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, status: 'completed', at: NOW })]
      rerenderSheet(renderer, { events: more, messages: conversation, scheme })
      expect(texts(renderer)).toContain('Tool calls (2+)')
      expect(textOf(renderer.root.find((node) => node.props.testID === 'task-transcript-status' && String(node.type) === 'Text'))).toBe('Completed')
    })
  }

  it('Back returns to the list', () => {
    renderer = renderSheet({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    openTranscript(renderer)
    act(() => {
      ;(pressable(renderer!, 'Back')[0]!.props.onPress as () => void)()
    })
    expect(pressable(renderer, 'Close')).toHaveLength(1)
    expect(texts(renderer)).toContain('Background tasks')
    expect(renderer.root.findAll((node) => node.props.testID === 'task-transcript-title')).toHaveLength(0)
  })

  it('lists no calls for an agent that has made none yet', () => {
    renderer = renderSheet({ events: [...calls, ...agentAndShellStarted()], messages: conversation })
    openTranscript(renderer)
    expect(texts(renderer)).toContain('Prompt')
    expect(texts(renderer).some((text) => text.startsWith('Tool calls'))).toBe(false)
  })

  // The agent's file holds the calls made before the loaded window; the stream's own text is no call.
  const fileToolCalls = (props: AgentToolCallsProps) => createElement('FileToolCalls', { testID: 'agent-file-tool-calls', toolUseId: props.toolUseId })
  const fileListShown = (shown: ReactTestRenderer) => shown.root.findAll((node) => String(node.type) === 'FileToolCalls').length

  it("reads the agent's calls from its file while the stream holds only the agent's text", () => {
    const events = [...calls, ...agentAndShellStarted(), subagentText('Looking at the sheet first.', T0 + 2_000)]
    renderer = renderSheet({ events, messages: conversation, fileToolCalls })
    openTranscript(renderer)
    expect(fileListShown(renderer)).toBe(1)
  })

  // Review 2026-10-15: the tab's store drops a subagent's older events, so the stream alone
  // undercounts a long agent. The Agent sheet's own list (the file as the baseline, the stream added
  // to it; subagent-stream-file-union.ts) stays in charge once the stream holds a call.
  it("keeps the agent's file as the baseline once the stream holds one of its calls", () => {
    const events = [...calls, ...agentAndShellStarted(), subagentText('Looking at the sheet first.', T0 + 1_500), ...subagentBashCall('toolu_sub1', 'ls', 'List the session files', T0 + 2_000)]
    renderer = renderSheet({ events, messages: conversation, fileToolCalls })
    openTranscript(renderer)
    expect(fileListShown(renderer)).toBe(1)
    expect(renderer.root.find((node) => String(node.type) === 'FileToolCalls').props.toolUseId).toBe(AGENT_CALL)
  })

  it("reads the file for an agent the stream has nothing of yet", () => {
    renderer = renderSheet({ events: [...calls, ...agentAndShellStarted()], messages: conversation, fileToolCalls })
    openTranscript(renderer)
    expect(fileListShown(renderer)).toBe(1)
  })
})
