import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTaskHostStatus } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { subagentShellsLabel } from './mobile-background-task-footer'
import { MobileBackgroundTaskCard as BackgroundTaskCard } from './MobileBackgroundTaskCard'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { useSubagentRunClock } from './use-subagent-run-clock'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { SheetFailureLine } from './SheetFailureLine'
import { useSheetFailure, type SheetFailureReport } from './use-sheet-failure'
import { useSubagentActivityWatch, type SubagentActivitySource } from './use-subagent-activity-watch'
import { useMobileBackgroundTaskStops } from './use-mobile-background-task-stops'
import { stopAllTargets, useMobileBackgroundTasksStopAll } from './use-mobile-background-tasks-stop-all'
import type { ClaudeBackgroundStopTarget } from './claude-background-dialog'
import { terminalStopTargets } from './terminal-background-task-stops'

/** Whether the sheet's host is reachable, and which connection it is on. */
export type BackgroundTasksConnection = { connected: boolean; lastConnectedAt: number | null }

/** A Stop as the chat sends it: resolves true only when the host confirmed the task stopped. A
 *  caller that does not say (void) is read as unconfirmed, so the row's button comes back.
 *  `target` is what a terminal tab's Stop selects in Claude's own Background dialog
 *  (terminal-background-task-stops.ts); the structured lane stops by id and ignores it. */
export type BackgroundTaskStopHandler = (
  taskId: string,
  report?: SheetFailureReport,
  target?: ClaudeBackgroundStopTarget
) => Promise<boolean> | void

/** Finished tasks arrive a page at a time: a long session can hold hundreds,
 *  and a phone sheet that paints them all scrolls forever. */
const FINISHED_PAGE = 10
const TICK_MS = 1000

/** The list of background work the agent has in flight and has finished. A
 *  terminal-driven tab has only the transcript the chat view already holds; a
 *  structured tab gets the provider's own roster from the host, which can also
 *  stop one task by name. A row carries a stop control only where the host
 *  says it accepts one. */
export function MobileBackgroundTasksSheet({
  visible,
  messages,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask,
  reportStopFailure,
  scopeKey = null,
  connection,
  subagentSource = null,
  onClose
}: {
  visible: boolean
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  /** `report` is where this Stop's failure is said: the sheet, while open. */
  onStopTask?: BackgroundTaskStopHandler
  /** The chat's banner, or its toast, and the tab it belongs to: where a failed
   *  Stop goes once the sheet is not showing it. Without it the sheet hands
   *  the Stop no reporter, and the lane says a failure on the banner. */
  reportStopFailure?: SheetFailureReport
  scopeKey?: string | null
  connection?: BackgroundTasksConnection
  /** Where the running agents' own transcripts are (a Claude tab): read only
   *  while the sheet is open, for each agent's latest step and its shells. */
  subagentSource?: SubagentActivitySource | null
  onClose: () => void
}) {
  // Why the sheet says a failed Stop itself: it draws in its own native window,
  // over the chat's banner, and the row keeps its Stop until the host says the
  // task ended. A reason said only on the banner left a Stop that seemed to do
  // nothing (2026-09-25), the defect the session-option drawer had too.
  const failure = useSheetFailure({
    open: visible,
    scopeKey,
    reportFailure: reportStopFailure ?? ignoreFailure
  })
  const stop =
    onStopTask && reportStopFailure
      ? (taskId: string, report?: SheetFailureReport, target?: ClaudeBackgroundStopTarget) => {
          if (!report) {
            failure.clear()
          }
          return onStopTask(taskId, report ?? failure.reporter(), target)
        }
      : onStopTask
  // Stop all names every task that did not stop on the sheet's own line.
  const reportStopAll = reportStopFailure
    ? (text: string) => {
        failure.clear()
        failure.reporter()(text)
      }
    : undefined
  return (
    // Opens part way and drags up to full screen, as the Claude app's does.
    // The title rides above the list rather than in it, so it stays in view
    // while the list scrolls, and a drag on it moves the sheet.
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss
      dismissKeyboardOnOpen
      expandable
      header={<MobileBackgroundTasksSheetHeader onClose={onClose} stopFailure={failure.shown} />}
    >
      <MobileBackgroundTasksSheetBody
        messages={messages}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        onStopTask={stop}
        onStopAllFailed={reportStopAll}
        connection={connection}
        subagentSource={visible ? subagentSource : null}
      />
    </BottomDrawer>
  )
}

// Never called: the sheet makes a reporter only when it was handed one.
const ignoreFailure: SheetFailureReport = () => undefined

/** The sheet's title and close cross, with why the last Stop did not go
 *  through under them. The drawer pins it above the list. */
export function MobileBackgroundTasksSheetHeader({
  onClose,
  stopFailure = null
}: {
  onClose?: () => void
  stopFailure?: string | null
}) {
  const { space } = useTheme()
  return (
    <View style={{ gap: space.sm, paddingBottom: space.sm }}>
      <MobileSheetTitleBar title="Background tasks" onClose={onClose} />
      {stopFailure ? <SheetFailureLine>{stopFailure}</SheetFailureLine> : null}
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
  onStopTask,
  onStopAllFailed,
  connection,
  subagentSource = null
}: {
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  onStopTask?: BackgroundTaskStopHandler
  /** Where a Stop all names the tasks that did not stop: the sheet's failure line. */
  onStopAllFailed?: (text: string) => void
  /** The host connection. Absent reads as connected (a caller that cannot tell). */
  connection?: BackgroundTasksConnection
  /** Read the running agents' transcripts while this is set (the sheet passes
   *  it only while open). Null reads nothing. */
  subagentSource?: SubagentActivitySource | null
}) {
  const { space } = useTheme()
  const [now, setNow] = useState(() => Date.now())
  // Disconnected, nothing here is current: running rows say so and take no Stop. A NEW connection
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
  const watched = useSubagentActivityWatch({
    tasks: lane.tasks,
    source: lane.structured ? null : subagentSource,
    report: backgroundTaskReport,
    now
  })
  // A terminal tab's Stop goes through Claude's own Background dialog, which
  // can select only some rows (terminal-background-task-stops.ts); the rest
  // draw no Stop. The structured lane's rows say so themselves.
  const footerShells = backgroundTaskReport?.onScreenShellCount ?? null
  const terminalStops = useMemo(
    () => (!lane.structured && onStopTask ? terminalStopTargets(watched, footerShells) : null),
    [footerShells, lane.structured, onStopTask, watched]
  )
  const { running, finished, shellsInSubagents } = terminalStops?.tasks ?? watched
  const targets = terminalStops?.targets ?? null
  const runningIds = useMemo(() => running.map((task) => task.id), [running])
  const stopOne = useMemo(
    () =>
      onStopTask
        ? async (taskId: string, report?: SheetFailureReport) =>
            (await onStopTask(taskId, report, targets?.get(taskId))) === true
        : undefined,
    [onStopTask, targets]
  )
  const stops = useMobileBackgroundTaskStops({ runningIds, stop: stopOne, connection: connectedAt })
  // On a terminal tab the agents go first: an agent's Stop needs the shells pill
  // that a running shell keeps on Claude's footer (terminal-background-task-stops.ts).
  const stopAllTasks = useMemo(() => {
    const all = stopAllTargets(running, stops.holding)
    return targets ? [...all.filter((task) => task.kind === 'agent'), ...all.filter((task) => task.kind !== 'agent')] : all
  }, [running, stops.holding, targets])
  const stopAll = useMobileBackgroundTasksStopAll({
    targets: stopAllTasks,
    onStop: stops.onStop,
    onFailed: onStopAllFailed
  })
  const ticking = running.some((task) => task.startedAt !== null)
  useEffect(() => {
    if (!ticking) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return (
    <View style={{ paddingBottom: space.md, gap: space.sm }}>
      <BackgroundTasksSection
        title="Running"
        open={runningOpen}
        onToggle={() => setRunningOpen((open) => !open)}
        action={stopOne && !disconnected && stopAllTasks.length > 0 ? <StopAllButton onPress={stopAll} /> : null}
      >
        {disconnected && running.length > 0 ? (
          <Txt variant="caption" tone="muted">
            Status unknown — reconnecting
          </Txt>
        ) : null}
        {/* One flat list. The per-kind headings ("Shells · 4", "Agents · 2")
            were removed at the user's request on 2026-09-15 — the row's own
            count already says how much is running, and the labels were noise
            above a short list. This supersedes the 2026-09-14 ask to show the
            two kinds as separate labelled groups. */}
        {running.length > 0 ? (
          running.map((task) => (
            <BackgroundTaskCard
              key={task.id}
              task={task}
              onStop={stopOne && !disconnected ? (taskId) => void stops.onStop(taskId) : undefined}
              stopHeld={stops.holding.has(task.id)}
              statusUnknown={disconnected}
            />
          ))
        ) : shellsInSubagents ? null : (
          <Txt variant="caption" tone="muted">
            Nothing running.
          </Txt>
        )}
        {/* What the footer counts beyond the lead and the listed subagent
            shells: shells no transcript the phone reads names
            (docs/subagent-task-visibility.md). */}
        {shellsInSubagents ? (
          <Txt variant="caption" tone="muted">
            {subagentShellsLabel(shellsInSubagents)}
          </Txt>
        ) : null}
      </BackgroundTasksSection>
      {finished.length > 0 ? (
        <BackgroundTasksSection
          title="Finished"
          count={finished.length}
          open={finishedOpen}
          onToggle={() => setFinishedOpen((open) => !open)}
        >
          {finished.slice(0, finishedShown).map((task) => (
            <BackgroundTaskCard key={task.id} task={task} />
          ))}
          {finished.length > finishedShown ? (
            <LoadMoreFinished onPress={() => setFinishedShown((shown) => shown + FINISHED_PAGE)} />
          ) : null}
        </BackgroundTasksSection>
      ) : null}
    </View>
  )
}

function BackgroundTasksSection({
  title,
  count,
  open,
  onToggle,
  action = null,
  children
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  /** Drawn at the header's right, beside the title row (Running's Stop all). */
  action?: ReactNode
  children: ReactNode
}) {
  const { colors, space } = useTheme()
  const heading = count === undefined ? title : `${title} ${count}`
  return (
    <View style={{ gap: space.sm, paddingTop: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${heading}, ${open ? 'collapse' : 'expand'}`}
          onPress={onToggle}
          hitSlop={10}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 28 }}
        >
          <Txt variant="label" tone="muted">
            {heading}
          </Txt>
          {open ? (
            <ChevronDown size={16} color={colors.textMuted} />
          ) : (
            <ChevronRight size={16} color={colors.textMuted} />
          )}
        </Pressable>
        {action}
      </View>
      {open ? <View style={{ gap: space.sm }}>{children}</View> : null}
    </View>
  )
}

/** Running's "Stop all", a quiet text button at the header's right so the cards keep their look. */
function StopAllButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stop all running tasks"
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({ minHeight: 28, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Txt variant="caption" weight="semibold" tone="secondary">
        Stop all
      </Txt>
    </Pressable>
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
