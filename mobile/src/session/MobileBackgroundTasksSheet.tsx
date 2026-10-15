import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTask, BackgroundTaskHostStatus } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { MobileBackgroundTaskCard as BackgroundTaskCard } from './MobileBackgroundTaskCard'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { useSubagentRunClock } from './use-subagent-run-clock'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useSubagentActivityWatch, type SubagentActivitySource } from './use-subagent-activity-watch'
import { useClaudeChatLive, type ClaudeChatLiveStream } from './claude-chat-live'
import { useCcrBackgroundTaskLane, useCcrTaskStops, type CcrStopTask } from './use-ccr-background-task-lane'
import { agentTaskPairs, findAgentTaskPair, type BackgroundTaskTranscriptPage } from './mobile-background-task-agent-pairs'

/** Whether the sheet's host is reachable, and which connection it is on. */
export type BackgroundTasksConnection = { connected: boolean; lastConnectedAt: number | null }

/** Finished tasks arrive a page at a time: a long session can hold hundreds,
 *  and a phone sheet that paints them all scrolls forever. */
const FINISHED_PAGE = 10
const TICK_MS = 1000

/** The list of background work the agent has in flight and has finished. A
 *  terminal-driven tab has only the transcript the chat view already holds; a
 *  structured tab gets the provider's own roster from the host.
 *
 *  Since 2026-10-15 (the user: "same like Claude Mobile", and the running tasks
 *  in Claude and Code UI must be the same): a Claude tab whose Anthropic stream
 *  is live lists what the Claude app lists, from the same events
 *  (ccr-background-tasks.ts), with its Stop on each running row and "View
 *  transcript" on each agent whose Agent call is in the conversation; that link
 *  pushes the call's page into this same sheet, with a back arrow
 *  (MobileBackgroundTaskTranscriptPage.tsx). The desktop's lanes stay as they
 *  were when the stream is not live: no Stop (no-stop.test.tsx). */
export function MobileBackgroundTasksSheet({
  visible,
  messages,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  connection,
  subagentSource = null,
  onShowOutput,
  onAfterClose,
  onClose,
  stopTask,
  transcriptPage = null
}: {
  visible: boolean
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  connection?: BackgroundTasksConnection
  /** Where the running agents' own transcripts are (a Claude tab): read only
   *  while the sheet is open, for the shells and agents each agent launched. */
  subagentSource?: SubagentActivitySource | null
  /** A finished shell's row was tapped: the caller closes this sheet and opens its output. */
  onShowOutput?: (task: BackgroundTask) => void
  /** Fires once the sheet has left the screen. */
  onAfterClose?: () => void
  onClose: () => void
  /** Sends a Stop on Anthropic's lane; tests replace it. */
  stopTask?: CcrStopTask
  /** An agent's "View transcript" page (mobile-background-task-agent-pairs.ts); null offers no link. */
  transcriptPage?: BackgroundTaskTranscriptPage | null
}) {
  const stream = useClaudeChatLive()?.stream ?? null
  const [page, setPage] = useState<BackgroundTask | null>(null)
  const pairs = useMemo(() => (visible && transcriptPage ? agentTaskPairs(messages) : null), [messages, transcriptPage, visible])
  const pagePair = page && pairs ? findAgentTaskPair(pairs, page) : null
  const livePage = useLivePageTask(page, stream)
  const shownPage = page && transcriptPage ? (livePage ?? page) : null
  return (
    // Opens part way and drags up to full screen, as the Claude app's does.
    // The title rides above the list rather than in it, so it stays in view
    // while the list scrolls, and a drag on it moves the sheet.
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={() => {
        setPage(null)
        onAfterClose?.()
      }}
      dragContentToDismiss
      dismissKeyboardOnOpen
      expandable
      header={
        shownPage && transcriptPage ? (
          transcriptPage.header({ task: shownPage, pair: pagePair, onBack: () => setPage(null) })
        ) : (
          <MobileBackgroundTasksSheetHeader onClose={onClose} />
        )
      }
    >
      {shownPage && transcriptPage ? transcriptPage.body({ task: shownPage, pair: pagePair, stream }) : null}
      {/* Kept mounted under the page, so Back finds the list as it was left. */}
      <View style={shownPage ? { display: 'none' } : null}>
      <MobileBackgroundTasksSheetBody
        messages={messages}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        connection={connection}
        subagentSource={visible ? subagentSource : null}
        onShowOutput={onShowOutput}
        stream={stream}
        stopTask={stopTask}
        canViewTranscript={pairs ? (task) => findAgentTaskPair(pairs, task) !== null : undefined}
        onViewTranscript={setPage}
      />
      </View>
    </BottomDrawer>
  )
}

/** The page's task as the stream has it now (its status moves while the page is up); the row as
 *  tapped when the stream is not live. */
function useLivePageTask(task: BackgroundTask | null, stream: ClaudeChatLiveStream | null): BackgroundTask | null {
  const lane = useCcrBackgroundTaskLane(task ? stream : null, 0)
  return lane && task ? ([...lane.running, ...lane.finished].find((row) => row.id === task.id) ?? null) : null
}

/** The sheet's title and close cross. The drawer pins it above the list. */
export function MobileBackgroundTasksSheetHeader({ onClose }: { onClose?: () => void }) {
  const { space } = useTheme()
  return (
    // Claude's close cross and title sit 8 dp further in than the drawer's edge.
    <View style={{ paddingHorizontal: space.sm }}>
      <MobileSheetTitleBar title="Background tasks" onClose={onClose} />
    </View>
  )
}

/** The sheet's list, exported so render tests can mount it without the
 *  drawer's gesture/animation stack. */
export function MobileBackgroundTasksSheetBody({
  messages,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  connection,
  subagentSource = null,
  onShowOutput,
  stream = null,
  stopTask,
  canViewTranscript,
  onViewTranscript
}: {
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  /** The host connection. Absent reads as connected (a caller that cannot tell). */
  connection?: BackgroundTasksConnection
  /** Read the running agents' transcripts while this is set (the sheet passes
   *  it only while open). Null reads nothing. */
  subagentSource?: SubagentActivitySource | null
  /** Makes each finished shell's row open its output. */
  onShowOutput?: (task: BackgroundTask) => void
  /** Anthropic's live stream: its tasks replace the desktop's, and its rows can be stopped. */
  stream?: ClaudeChatLiveStream | null
  stopTask?: CcrStopTask
  /** Whether an agent row's Agent call is in the conversation, so its transcript can open. */
  canViewTranscript?: (task: BackgroundTask) => boolean
  onViewTranscript?: (task: BackgroundTask) => void
}) {
  const { space } = useTheme()
  const [now, setNow] = useState(() => Date.now())
  // Disconnected, nothing here is current: running rows say so. A NEW connection
  // (its `lastConnectedAt`) re-reads at once, by itself (CLAUDE.md, nothing stays stale).
  const disconnected = connection?.connected === false
  const connectedAt = connection?.lastConnectedAt ?? null
  useEffect(() => setNow(Date.now()), [connectedAt])
  // A roster subagent's time is the run the phone watched begin, never the
  // host's first-observed age (2026-09-20, "13h 16m" beside the desk's "1m 23s").
  const subagentRuns = useSubagentRunClock(agentStatus)
  const [runningOpen, setRunningOpen] = useState(true)
  const [finishedOpen, setFinishedOpen] = useState(true)
  const [finishedShown, setFinishedShown] = useState(FINISHED_PAGE)
  // Re-derived on each tick rather than caching elapsed separately: the walk is
  // linear over the loaded window and only runs while the sheet is open, and
  // one source of truth beats a second, staler copy of the same number.
  const lane = useMemo(() => {
    const structured = projectStructuredBackgroundTasks(hostBackgroundTasks, now)
    return structured
      ? { tasks: structured, structured: true }
      : { tasks: deriveReportedBackgroundTasks(messages, now, agentStatus, backgroundTaskReport, subagentRuns), structured: false }
  }, [agentStatus, backgroundTaskReport, hostBackgroundTasks, messages, now, subagentRuns])
  // A structured lane has the provider's own roster; only a transcript-read
  // (terminal) lane gets its agents' steps and shells from their transcripts.
  // An agent a read subagent launched is listed while the host's roster holds
  // it (the Claude app lists them; `mobile-subagent-activity.ts`).
  const hostSubagents = (agentStatus ?? backgroundTaskReport?.heldAgentStatus ?? null)?.subagents ?? null
  const anthropic = useCcrBackgroundTaskLane(stream, now)
  const watched = useSubagentActivityWatch({
    tasks: lane.tasks,
    source: lane.structured || anthropic ? null : subagentSource,
    report: backgroundTaskReport,
    hostSubagents,
    now
  })
  const { running, finished } = anthropic ?? watched
  const stops = useCcrTaskStops(anthropic ? stream : null, running, stopTask)
  // Only on Anthropic's lane: the desktop's rows have offered no link since 2026-10-10.
  const viewTranscript = anthropic && onViewTranscript && canViewTranscript ? (task: BackgroundTask) => canViewTranscript(task) : () => false
  const ticking = running.some((task) => task.startedAt !== null)
  useEffect(() => {
    if (!ticking) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return (
    // Claude's list sits 24 dp in from the screen's edges, 12 dp further than
    // the drawer's own padding, and leaves 24 dp between Running and Finished.
    // No Stop all at Running's right (the Claude app has none). A row's own
    // Stop is drawn only on Anthropic's lane (2026-10-15, "same like Claude
    // Mobile"); the desktop's lanes keep none, as asked on 2026-10-11.
    <View style={{ paddingBottom: space.md, paddingHorizontal: space.md, gap: space.xl }}>
      <BackgroundTasksSection title="Running" open={runningOpen} onToggle={() => setRunningOpen((open) => !open)}>
        {disconnected && !anthropic && running.length > 0 ? (
          <Txt variant="caption" tone="muted">
            Status unknown — reconnecting
          </Txt>
        ) : null}
        {/* One flat list. The per-kind headings ("Shells · 4", "Agents · 2")
            were removed at the user's request on 2026-09-15 — the row's own
            count already says how much is running, and the labels were noise
            above a short list. This supersedes the 2026-09-14 ask to show the
            two kinds as separate labelled groups. */}
        {stops.failed ? (
          <Txt variant="caption" tone="danger">
            {stops.failed}
          </Txt>
        ) : null}
        {running.length > 0 ? (
          running.map((task) => (
            <BackgroundTaskCard
              key={task.id}
              task={task}
              statusUnknown={disconnected && !anthropic}
              onStop={stops.stop ?? undefined}
              stopping={stops.stopping.has(task.id)}
              onViewTranscript={viewTranscript(task) ? onViewTranscript : undefined}
            />
          ))
        ) : (
          <Txt variant="caption" tone="muted">
            Nothing running.
          </Txt>
        )}
        {/* No "+N shells in subagents" line (2026-10-11): the footer's count
            it came from also holds shells finished subagents left running,
            which the Claude app does not list, and the user asked for it
            gone. A subagent's shells are rows of their own while the sheet
            reads its transcript (mobile-subagent-activity.ts). */}
      </BackgroundTasksSection>
      {finished.length > 0 ? (
        <BackgroundTasksSection
          title="Finished"
          count={finished.length}
          open={finishedOpen}
          onToggle={() => setFinishedOpen((open) => !open)}
        >
          {finished.slice(0, finishedShown).map((task) => (
            <BackgroundTaskCard key={task.id} task={task} onShowOutput={onShowOutput} onViewTranscript={viewTranscript(task) ? onViewTranscript : undefined} />
          ))}
          {finished.length > finishedShown ? (
            <LoadMoreFinished onPress={() => setFinishedShown((shown) => shown + FINISHED_PAGE)} />
          ) : null}
        </BackgroundTasksSection>
      ) : null}
    </View>
  )
}

/** A section as Claude heads it: "Running ⌄", "Finished 74 ⌄" in the caption size and the muted
 *  ink, with a thin chevron 6 dp after the word, and its cards 16 dp apart under it. */
function BackgroundTasksSection({
  title,
  count,
  open,
  onToggle,
  children
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { colors, space } = useTheme()
  const heading = count === undefined ? title : `${title} ${count}`
  return (
    <View style={{ gap: space.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${heading}, ${open ? 'collapse' : 'expand'}`}
        onPress={onToggle}
        hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 24 }}
      >
        <Txt variant="caption" tone="muted">
          {heading}
        </Txt>
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} color={colors.textMuted} />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} color={colors.textMuted} />
        )}
      </Pressable>
      {open ? <View style={{ gap: space.lg }}>{children}</View> : null}
    </View>
  )
}

function LoadMoreFinished({ onPress }: { onPress: () => void }) {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      hitSlop={tapTargetHitSlop({ height: 40 })}
      accessibilityRole="button"
      accessibilityLabel="Load more finished tasks"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 40,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: space.md,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
    >
      <Txt variant="caption" weight="semibold" tone="secondary">
        Load more
      </Txt>
    </Pressable>
  )
}
