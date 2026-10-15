// The Background tasks sheet reads Anthropic's list only if two hand-offs are made, neither of
// which any render test of the sheet crosses: the chat controller puts the matched session's
// events on the chat's live state, and the tab's tasks provider hands the sheet its transcript
// page. Both are wiring with no behaviour of their own to drive, so their source is read (CLAUDE.md
// item 6), matching code, not the comments above it.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ccrBackgroundTaskRows } from './ccr-background-tasks'
import { CCR_IDLE_LIVE_STATE, deriveCcrLiveState } from './ccr-live-state'
import type { CcrEvent } from './ccr-session-api'
import { claudeChatLive } from './claude-chat-live'
import { BACKGROUND_AGENT } from './fixtures/claude-background-agent-launch-2.1.296'
import { SHELL_ID, T0, agentAndShellStarted, taskStarted, tasksChanged } from './fixtures/ccr-background-task-events-2.1.300'

const code = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    .split('\n')
    .filter((line: string) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n')

const STREAM = { events: [], accountId: 'acct', sessionId: 'session_01' }

describe("the sheet is handed Anthropic's stream only while it is live", () => {
  it('carries the stream on the live state while the link is live, and nothing otherwise', () => {
    const base = { live: CCR_IDLE_LIVE_STATE, connectionStatus: null, relayConnected: true, stream: STREAM }
    expect(claudeChatLive({ ...base, linkPhase: 'live' })?.stream).toMatchObject({ ...STREAM, tasks: [] })
    expect(claudeChatLive({ ...base, linkPhase: 'lost' })?.stream).toBeNull()
    expect(claudeChatLive({ ...base, linkPhase: 'live', stream: null })?.stream).toBeNull()
  })

  it("the controller puts the matched session's events on the chat's live state", () => {
    expect(code('use-mobile-native-chat-controller.ts')).toMatch(
      /claudeChatLive\(\{[^}]*stream: claudeApi\.gate\.kind === 'matched' \? \{ events: claudeApi\.events, accountId: claudeApi\.gate\.accountId, sessionId: claudeApi\.gate\.sessionId \} : null/
    )
  })

  it('the tasks provider hands the sheet its transcript page', () => {
    const provider = code('MobileNativeChatTasksProvider.tsx')
    const sheet = provider.slice(provider.indexOf('<MobileBackgroundTasksSheet'), provider.indexOf('/>', provider.indexOf('<MobileBackgroundTasksSheet')))
    expect(sheet).toContain('transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE}')
  })
})

// The app's header line ("N running tasks") and its sheet's Running list are one derivation over
// the same task records (mt2.v and mt2.t, y07.java `c`, 1.261013.20), so the two never disagree;
// `background_tasks_changed`'s own count is not it. The header here takes `runningCount`, the
// sheet the rows of `stream.tasks`.
describe("the header's running count is the sheet's Running list, as in the Claude app", () => {
  const NOW = T0 + 600_000
  const base = { live: { ...CCR_IDLE_LIVE_STATE, runningTasks: 4 }, connectionStatus: null, relayConnected: true, linkPhase: 'live' as const }
  // The live state folded from the very same events, as the link folds them.
  const agree = (events: CcrEvent[], count: number) => {
    const folded = deriveCcrLiveState(events, { liveFrom: 0, streamThinking: null, connectionStatus: null })
    const live = claudeChatLive({ ...base, live: folded, stream: { ...STREAM, events } })
    expect(live?.runningCount).toBe(count)
    expect(ccrBackgroundTaskRows(live?.stream?.tasks ?? [], NOW).running).toHaveLength(count)
  }

  it('counts no monitor, which the sheet does not list', () => {
    agree(
      [
        ...agentAndShellStarted(),
        taskStarted({ taskId: 'mon', toolUseId: 'toolu_m', taskType: 'monitor_mcp', description: 'Watch', at: T0 }),
        tasksChanged(
          [
            { taskId: BACKGROUND_AGENT.agentId, taskType: 'local_agent' },
            { taskId: SHELL_ID, taskType: 'local_bash' },
            { taskId: 'mon', taskType: 'monitor_mcp' }
          ],
          T0 + 400_000
        )
      ],
      2
    )
  })

  it('counts no task the background list names with no task_started loaded', () => {
    agree([tasksChanged([{ taskId: 'listed', taskType: 'local_bash' }, { taskId: 'listed-2', taskType: 'local_agent' }], T0)], 0)
  })

  it('counts a remote agent, which the sheet lists, though the background list leaves it out', () => {
    agree([taskStarted({ taskId: 'remote', toolUseId: 'toolu_r', taskType: 'remote_agent', description: 'Cloud agent', at: T0 }), tasksChanged([], T0 + 1)], 1)
  })

  it('counts nothing for a live stream with no task at all', () => {
    agree([], 0)
  })

  it("keeps the live state's count while the matched session's stream is not on it", () => {
    expect(claudeChatLive({ ...base, stream: null })?.runningCount).toBe(4)
    expect(claudeChatLive({ ...base, linkPhase: 'lost', stream: { ...STREAM, events: agentAndShellStarted() } })?.runningCount).toBeNull()
  })
})
