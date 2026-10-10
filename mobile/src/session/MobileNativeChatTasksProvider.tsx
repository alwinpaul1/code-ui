import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatSessionIdentity } from './native-chat-kept-session'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { nativeChatToolRunOutcome } from '../../../src/shared/native-chat-tool-run-outcome'
import { agentRunState } from './mobile-native-chat-agent-run'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { MobileNativeChatRunSheet } from './MobileNativeChatRunSheet'
import { MobileNativeChatToolDetailSheet } from './MobileNativeChatToolDetailSheet'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { MobileBackgroundTasksSheet, type BackgroundTaskStopHandler } from './MobileBackgroundTasksSheet'
import {
  NativeChatAgentRunsContext,
  NativeChatRunSheetContext,
  NativeChatTasksContext,
  type NativeChatRunSheetControl
} from './native-chat-tasks-context'
import { followSubagentTranscriptRunning, openSubagentTranscript } from './subagent-transcript-store'
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
  sessionIdentity,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask,
  reportStopFailure,
  scopeKey,
  children
}: {
  /** The UNFILTERED transcript: the notifications that retire a task are
   *  harness noise the folded list drops. */
  messages: readonly NativeChatMessage[]
  agent?: string | null
  agentWorking: boolean
  agentStatus?: AgentStatusEntry | null
  /** The session the chat reads: its transcript is the parent of a
   *  subagent's, whatever a nested agent's status names (native-chat-kept-session.ts). */
  sessionIdentity?: NativeChatSessionIdentity | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  onStopTask?: BackgroundTaskStopHandler
  /** The chat's banner, or its toast, and the tab it belongs to: where a failed
   *  Stop goes when the sheet is not showing it. */
  reportStopFailure?: (message: string) => void
  scopeKey?: string | null
  children: ReactNode
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  // The run whose sheet is up, kept while the sheet leaves so its rows do not
  // blank mid-animation; cleared once it has gone (`finishRunSheet`).
  const [runSheet, setRunSheet] = useState<{ blocks: readonly NativeChatBlock[]; visible: boolean; owner: object } | null>(null)
  // The call a run-sheet row chose, and the detail sheet that shows it. The
  // detail opens only after the run sheet has left, so the two never overlap.
  const [detailPair, setDetailPair] = useState<NativeChatToolPair | null>(null)
  const chosenPair = useRef<NativeChatToolPair | null>(null)
  const openRunBlocks = runSheet?.blocks ?? null
  const running = useMobileRunningTasks({ messages, agentStatus, backgroundTaskReport, hostBackgroundTasks })
  const parentTranscriptPath =
    sessionIdentity?.transcriptPath ?? agentStatus?.providerSession?.transcriptPath ?? null
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
      ...(agent === 'claude' ? { openTranscript } : {})
    }),
    [agent, agentWorking, messages, openTranscript, running, subagents]
  )
  // The open subagent viewer sits outside this tree; its header said "Running"
  // for as long as it stayed open, because it only ever read the tap.
  useEffect(() => followSubagentTranscriptRunning(agentRuns.runningIds), [agentRuns.runningIds])
  const runSheetControl = useMemo<NativeChatRunSheetControl>(
    () => ({
      open: (blocks, owner) => setRunSheet({ blocks, visible: true, owner }),
      // Only the row whose sheet is up refreshes it, and only when its blocks changed.
      sync: (blocks, owner) =>
        setRunSheet((sheet) => (sheet?.visible && sheet.owner === owner && sheet.blocks !== blocks ? { ...sheet, blocks } : sheet))
    }),
    []
  )
  const openSheet = useCallback(() => setSheetOpen(true), [])
  // Re-read while open, so a row that finishes while its sheet is up says so.
  const openRun = openRunBlocks ? agentRunState(openRunBlocks, agentRuns) : null
  const rows = useMemo(
    () => (openRunBlocks && openRun ? runSheetRows(openRunBlocks, openRun.entries) : []),
    [openRunBlocks, openRun]
  )
  const runTitle = openRunBlocks
    ? toolRunSentence(
        openRunBlocks,
        nativeChatToolRunOutcome(openRunBlocks, { activeTurnIsWorking: agentWorking }).failedCallCount
      ) || 'Tool calls'
    : ''
  const closeRunSheet = useCallback(() => setRunSheet((sheet) => (sheet ? { ...sheet, visible: false } : null)), [])
  const chooseRowPair = useCallback(
    (pair: NativeChatToolPair) => {
      chosenPair.current = pair
      closeRunSheet()
    },
    [closeRunSheet]
  )
  const finishRunSheet = useCallback(() => {
    setRunSheet(null)
    if (chosenPair.current) {
      setDetailPair(chosenPair.current)
      chosenPair.current = null
    }
  }, [])
  const tasks = useMemo(() => ({ runningCount: running.length, openSheet }), [openSheet, running.length])
  return (
    <NativeChatTasksContext.Provider value={tasks}>
      <NativeChatAgentRunsContext.Provider value={agentRuns}>
        <NativeChatRunSheetContext.Provider value={runSheetControl}>
        {children}
        <MobileNativeChatRunSheet
          visible={runSheet?.visible === true}
          title={runTitle}
          rows={rows}
          running={openRun?.running ?? false}
          onSelectPair={chooseRowPair}
          onOpenTranscript={agentRuns.openTranscript}
          onAfterClose={finishRunSheet}
          onClose={closeRunSheet}
        />
        <MobileNativeChatToolDetailSheet pair={detailPair} onClose={() => setDetailPair(null)} />
        <MobileBackgroundTasksSheet
          visible={sheetOpen}
          messages={messages}
          agentStatus={agentStatus ?? null}
          backgroundTaskReport={backgroundTaskReport}
          hostBackgroundTasks={hostBackgroundTasks}
          onStopTask={onStopTask}
          reportStopFailure={reportStopFailure}
          scopeKey={scopeKey}
          onClose={() => setSheetOpen(false)}
        />
        </NativeChatRunSheetContext.Provider>
      </NativeChatAgentRunsContext.Provider>
    </NativeChatTasksContext.Provider>
  )
}
