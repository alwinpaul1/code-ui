// Shared by the Background tasks sheet's Anthropic-lane tests (MobileBackgroundTasksSheet.anthropic
// *.test.tsx). Each test file keeps its own vi.mock calls: they are hoisted per file.

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { deriveCcrBackgroundTasks } from './ccr-background-tasks'
import type { CcrEvent } from './ccr-session-api'
import { ClaudeChatLiveContext, type ClaudeChatLive } from './claude-chat-live'
import { T0 } from './fixtures/ccr-background-task-events-2.1.300'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import { BACKGROUND_TASK_TRANSCRIPT_PAGE } from './MobileBackgroundTaskTranscriptPage'
import type { CcrStopTask } from './use-ccr-background-task-lane'
import { AgentToolCallsSlotProvider, type RenderAgentToolCalls } from './native-chat-agent-tool-calls-slot'

export const NOW = T0 + 600_000
export const PROMPT = 'Make the grouped-commands sheet match Claude’s.'

/** The chat's live state with the stream live on `events`, or no stream at all (`null`). */
export function live(events: readonly CcrEvent[] | null): ClaudeChatLive {
  return {
    footer: null,
    working: true,
    runningCount: 2,
    sessionConnection: null,
    linkLive: events !== null,
    rateLimit: null,
    stream: events ? { events, accountId: 'acct', sessionId: 'session_01', tasks: deriveCcrBackgroundTasks(events) } : null
  }
}

export function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}
export const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as never).map((node) => textOf(node))
/** Buttons by their label's start ("Stop task" finds "Stop task: …"), links by their text. */
export const pressable = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      (String(node.props.accessibilityLabel ?? '').startsWith(label) || (node.props.accessibilityRole === 'link' && textOf(node) === label))
  )
export const colorOf = (node: ReactTestInstance) => {
  const style = node.props.style
  return Object.assign({}, ...(Array.isArray(style) ? style.flat() : [style]).filter(Boolean)).color as string | undefined
}

/** The desktop's own transcript: a different shell, which the stream's list must not show. */
export const DESKTOP_MESSAGES: NativeChatMessage[] = [
  { id: 'd1', role: 'assistant', timestamp: T0, source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'sleep 99', description: 'Desktop-only shell', run_in_background: true } }] },
  { id: 'd2', role: 'tool', timestamp: T0 + 1, source: 'transcript', blocks: [{ type: 'tool-result', output: 'Command running in background with ID: dsk1234. Output is being written to: /tmp/x' }] }
]

type SheetArgs = {
  events: readonly CcrEvent[] | null
  messages?: NativeChatMessage[]
  scheme?: 'light' | 'dark'
  stopTask?: CcrStopTask
  /** False mounts the sheet with no ClaudeChatLive at all, as a tab with no Anthropic link. */
  withLive?: boolean
  /** The tasks provider's Agent-sheet slot (the agent's calls read from its file). */
  fileToolCalls?: RenderAgentToolCalls
}

function tree(args: SheetArgs) {
  const bare = (
    <MobileBackgroundTasksSheet visible messages={args.messages ?? []} onClose={() => undefined} stopTask={args.stopTask} transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE} />
  )
  const sheet = args.fileToolCalls ? <AgentToolCallsSlotProvider render={args.fileToolCalls}>{bare}</AgentToolCallsSlotProvider> : bare
  const value = live(args.events)
  return (
    <ThemeProvider initialPreference={args.scheme ?? 'light'}>
      {args.withLive === false ? sheet : <ClaudeChatLiveContext.Provider value={value}>{sheet}</ClaudeChatLiveContext.Provider>}
    </ThemeProvider>
  )
}

export function renderSheet(args: SheetArgs): ReactTestRenderer {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(tree(args))
  })
  return renderer
}

export function rerenderSheet(renderer: ReactTestRenderer, args: SheetArgs): void {
  act(() => {
    renderer.update(tree(args))
  })
}
