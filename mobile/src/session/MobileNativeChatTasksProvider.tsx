import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatSessionIdentity } from './native-chat-kept-session'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { nativeChatToolRunOutcome } from '../../../src/shared/native-chat-tool-run-outcome'
import { agentRunState } from './mobile-native-chat-agent-run'
import { rowLiveTaskIds } from './mobile-native-chat-row-live-tasks'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { MobileNativeChatRunSheet } from './MobileNativeChatRunSheet'
import { MobileNativeChatToolDetailSheet } from './MobileNativeChatToolDetailSheet'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { BACKGROUND_TASK_TRANSCRIPT_PAGE } from './MobileBackgroundTaskTranscriptPage'
import { MobileBackgroundTasksSheet, type BackgroundTasksConnection } from './MobileBackgroundTasksSheet'
import { MobileBackgroundShellOutputSheet } from './MobileBackgroundShellOutputSheet'
import type { BackgroundTask } from './mobile-background-tasks'
import { NativeChatTranscriptProvider } from './native-chat-transcript-context'
import { AgentToolCallsSlotProvider, type RenderAgentToolCalls } from './native-chat-agent-tool-calls-slot'
import { MobileNativeChatAgentToolCalls } from './MobileNativeChatAgentToolCalls'
import {
  NativeChatAgentRunsContext,
  NativeChatRunSheetContext,
  NativeChatTasksContext,
  type NativeChatRunSheetControl
} from './native-chat-tasks-context'
import { followSubagentTranscriptRunning, followSubagentTranscriptStream, openSubagentTranscript } from './subagent-transcript-store'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useMobileRunningTasks } from './use-mobile-running-task-count'
import { useBridgeBackgroundTasksToHeader } from './session-header-tasks-bridge'
import { useClaudeAppCommandSheet } from './claude-app-command-sheets'
import { useClaudeChatLive } from './claude-chat-live'

/** An Agent sheet's "Tool calls (N)" list (parity G29). */
const renderAgentToolCalls: RenderAgentToolCalls = (props) => <MobileNativeChatAgentToolCalls {...props} />

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
  hostConnection,
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
  /** The host connection; see MobileBackgroundTasksSheet's `connection`. */
  hostConnection?: BackgroundTasksConnection
  children: ReactNode
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  // A finished shell's output (parity G27): chosen on the tasks sheet, opened
  // once that sheet has left, so the two never overlap.
  const [outputTask, setOutputTask] = useState<BackgroundTask | null>(null)
  const chosenOutputTask = useRef<BackgroundTask | null>(null)
  // The run whose sheet is up, kept while the sheet leaves so its rows do not
  // blank mid-animation; cleared once it has gone (`finishRunSheet`).
  const [runSheet, setRunSheet] = useState<{ blocks: readonly NativeChatBlock[]; visible: boolean; owner: object } | null>(null)
  // The call a run-sheet row chose, and the detail sheet that shows it. The
  // detail opens only after the run sheet has left, so the two never overlap.
  const [detailPair, setDetailPair] = useState<{ pair: NativeChatToolPair; agentId: string | null } | null>(null)
  const chosenPair = useRef<{ pair: NativeChatToolPair; agentId: string | null } | null>(null)
  const openRunBlocks = runSheet?.blocks ?? null
  const running = useMobileRunningTasks({ messages, agentStatus, backgroundTaskReport, hostBackgroundTasks })
  const parentTranscriptPath =
    sessionIdentity?.transcriptPath ?? agentStatus?.providerSession?.transcriptPath ?? null
  const transcriptTarget = useCallback(
    (agentId: string, title: string) =>
      subagentTranscriptTarget({ agent: agent ?? null, task: { id: agentId, kind: 'agent', title }, parentTranscriptPath }),
    [agent, parentTranscriptPath]
  )
  const openTranscript = useCallback(
    (agentId: string, title: string, isRunning: boolean) => {
      const target = transcriptTarget(agentId, title)
      if (target) {
        openSubagentTranscript(target, isRunning)
      }
    },
    [transcriptTarget]
  )
  // The sheet reads each running agent's own transcript while it is open.
  const subagentSource = useMemo(
    () => (agent === 'claude' ? { agent, parentTranscriptPath } : null),
    [agent, parentTranscriptPath]
  )
  const subagents = agentStatus?.subagents
  // Orca's hook status for the pane, the same the reader falls back on.
  const hostStatus = agentStatus ?? backgroundTaskReport?.heldAgentStatus ?? null
  const structuredRoster = hostBackgroundTasks !== undefined
  const agentRuns = useMemo(
    () => ({
      runningIds: new Set(running.filter((task) => task.kind === 'agent').map((task) => task.id)),
      // What a conversation row may sweep for: only what a source that will
      // also retire it says runs (mobile-native-chat-row-live-tasks.ts).
      liveTaskIds: rowLiveTaskIds(running, { structuredRoster, hostStatus }),
      confirmed: confirmedAgentDescriptions(messages, subagents),
      agentWorking,
      ...(agent === 'claude' ? { openTranscript, transcriptTarget } : {})
    }),
    [agent, agentWorking, hostStatus, messages, openTranscript, running, structuredRoster, subagents, transcriptTarget]
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
  const showShellOutput = useCallback((task: BackgroundTask) => {
    chosenOutputTask.current = task
    setSheetOpen(false)
  }, [])
  const finishTasksSheet = useCallback(() => {
    if (chosenOutputTask.current) {
      setOutputTask(chosenOutputTask.current)
      chosenOutputTask.current = null
    }
  }, [])
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
    (pair: NativeChatToolPair, agentId: string | null) => {
      chosenPair.current = { pair, agentId }
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
  // With Anthropic's stream live, the count is Anthropic's, counted from the same task records the
  // sheet lists (claude-chat-live.ts), as the Claude app's header and sheet are.
  const chatLive = useClaudeChatLive()
  const runningCount = chatLive?.runningCount ?? running.length
  // A subagent viewer opened from Anthropic's stream stays live on it (G8).
  const streamEvents = chatLive?.stream?.events ?? null
  useEffect(() => followSubagentTranscriptStream(streamEvents), [streamEvents])
  const tasks = useMemo(() => ({ runningCount, openSheet }), [openSheet, runningCount])
  // The header menu's Background tasks entry opens this same sheet (parity gap G35).
  useBridgeBackgroundTasksToHeader(runningCount, openSheet)
  // A matched Claude tab's typed /workflows opens this sheet, as the Claude app's does (claude-app-command-sheets.ts).
  useClaudeAppCommandSheet('workflows', openSheet)
  return (
    <NativeChatTranscriptProvider messages={messages}>
    <AgentToolCallsSlotProvider render={renderAgentToolCalls}>
    <NativeChatTasksContext.Provider value={tasks}>
      <NativeChatAgentRunsContext.Provider value={agentRuns}>
        <NativeChatRunSheetContext.Provider value={runSheetControl}>
        {children}
        <MobileNativeChatRunSheet
          visible={runSheet?.visible === true}
          title={runTitle}
          rows={rows}
          onSelectPair={chooseRowPair}
          onAfterClose={finishRunSheet}
          onClose={closeRunSheet}
        />
        <MobileNativeChatToolDetailSheet
          pair={detailPair?.pair ?? null}
          agentId={detailPair?.agentId ?? null}
          onClose={() => setDetailPair(null)}
        />
        <MobileBackgroundTasksSheet
          visible={sheetOpen}
          messages={messages}
          agentStatus={agentStatus ?? null}
          backgroundTaskReport={backgroundTaskReport}
          hostBackgroundTasks={hostBackgroundTasks}
          connection={hostConnection}
          subagentSource={subagentSource}
          onShowOutput={showShellOutput}
          transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE}
          onAfterClose={finishTasksSheet}
          onClose={() => setSheetOpen(false)}
        />
        <MobileBackgroundShellOutputSheet task={outputTask} messages={messages} onClose={() => setOutputTask(null)} />
        </NativeChatRunSheetContext.Provider>
      </NativeChatAgentRunsContext.Provider>
    </NativeChatTasksContext.Provider>
    </AgentToolCallsSlotProvider>
    </NativeChatTranscriptProvider>
  )
}
