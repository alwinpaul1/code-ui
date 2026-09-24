import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentRunState } from './mobile-native-chat-agent-run'
import { MobileNativeChatAgentRunSheet } from './MobileNativeChatAgentRunSheet'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import { NativeChatAgentRunsContext, NativeChatTasksContext } from './native-chat-tasks-context'
import { openSubagentTranscript } from './subagent-transcript-store'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useMobileRunningTasks } from './use-mobile-running-task-count'

/** The tab's background work, read once and handed to everything that shows
 *  it: the status line's count, the conversation's agent rows, and the
 *  Background tasks sheet this owns. One reader, so the three cannot drift. */
export function MobileNativeChatTasksProvider({
  messages,
  agent,
  agentWorking,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask,
  children
}: {
  /** The UNFILTERED transcript: the notifications that retire a task are
   *  harness noise the folded list drops. */
  messages: readonly NativeChatMessage[]
  agent?: string | null
  agentWorking: boolean
  agentStatus?: AgentStatusEntry | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  onStopTask?: (taskId: string) => void
  children: ReactNode
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [openRunBlocks, setOpenRunBlocks] = useState<readonly NativeChatBlock[] | null>(null)
  const running = useMobileRunningTasks({ messages, agentStatus, backgroundTaskReport, hostBackgroundTasks })
  const parentTranscriptPath = agentStatus?.providerSession?.transcriptPath ?? null
  const openTranscript = useCallback(
    (agentId: string, title: string, isRunning: boolean) => {
      const target = subagentTranscriptTarget({
        agent: agent ?? null,
        task: { id: agentId, kind: 'agent', title },
        parentTranscriptPath
      })
      if (target) {
        openSubagentTranscript(target, isRunning)
      }
    },
    [agent, parentTranscriptPath]
  )
  const subagents = agentStatus?.subagents
  const agentRuns = useMemo(
    () => ({
      runningIds: new Set(running.filter((task) => task.kind === 'agent').map((task) => task.id)),
      confirmed: confirmedAgentDescriptions(messages, subagents),
      agentWorking,
      openRun: setOpenRunBlocks,
      ...(agent === 'claude' ? { openTranscript } : {})
    }),
    [agent, agentWorking, messages, openTranscript, running, subagents]
  )
  const openSheet = useCallback(() => setSheetOpen(true), [])
  // Re-read while open, so a row that finishes while its sheet is up says so.
  const openRun = openRunBlocks ? agentRunState(openRunBlocks, agentRuns) : null
  const tasks = useMemo(() => ({ runningCount: running.length, openSheet }), [openSheet, running.length])
  return (
    <NativeChatTasksContext.Provider value={tasks}>
      <NativeChatAgentRunsContext.Provider value={agentRuns}>
        {children}
        <MobileNativeChatAgentRunSheet
          visible={openRun !== null}
          entries={openRun?.entries ?? []}
          running={openRun?.running ?? false}
          onOpenTranscript={agentRuns.openTranscript}
          onClose={() => setOpenRunBlocks(null)}
        />
        <MobileBackgroundTasksSheet
          visible={sheetOpen}
          messages={messages}
          agent={agent}
          agentStatus={agentStatus ?? null}
          backgroundTaskReport={backgroundTaskReport}
          hostBackgroundTasks={hostBackgroundTasks}
          onStopTask={onStopTask}
          onClose={() => setSheetOpen(false)}
        />
      </NativeChatAgentRunsContext.Provider>
    </NativeChatTasksContext.Provider>
  )
}
