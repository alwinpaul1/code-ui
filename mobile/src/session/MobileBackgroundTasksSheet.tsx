import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTaskHostStatus, BackgroundTask } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { MobileBackgroundTaskCard as BackgroundTaskCard } from './MobileBackgroundTaskCard'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { useSubagentRunClock } from './use-subagent-run-clock'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { openSubagentTranscript } from './subagent-transcript-store'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { SheetFailureLine } from './SheetFailureLine'
import { useSheetFailure, type SheetFailureReport } from './use-sheet-failure'

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
  agent,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask,
  reportStopFailure,
  scopeKey = null,
  onClose
}: {
  visible: boolean
  messages: readonly NativeChatMessage[]
  /** The tab's agent. Only a Claude subagent row opens a transcript viewer;
   *  Codex has no subagents, and an unknown agent gets no tap target. */
  agent?: string | null
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  /** `report` is where this Stop's failure is said: the sheet, while open. */
  onStopTask?: (taskId: string, report?: SheetFailureReport) => void
  /** The chat's banner, or its toast, and the tab it belongs to: where a failed
   *  Stop goes once the sheet is not showing it. Without it the sheet hands
   *  the Stop no reporter, and the lane says a failure on the banner. */
  reportStopFailure?: SheetFailureReport
  scopeKey?: string | null
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
      ? (taskId: string) => {
          failure.clear()
          onStopTask(taskId, failure.reporter())
        }
      : onStopTask
  return (
    // Opens part way and drags up to full screen, as the Claude app's does.
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss expandable>
      <MobileBackgroundTasksSheetBody
        onClose={onClose}
        messages={messages}
        agent={agent}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        onStopTask={stop}
        stopFailure={failure.shown}
      />
    </BottomDrawer>
  )
}

// Never called: the sheet makes a reporter only when it was handed one.
const ignoreFailure: SheetFailureReport = () => undefined

/** The sheet's contents, exported so render tests can mount them without the
 *  drawer's gesture/animation stack. */
export function MobileBackgroundTasksSheetBody({
  messages,
  agent = null,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask,
  stopFailure = null,
  onClose
}: {
  messages: readonly NativeChatMessage[]
  agent?: string | null
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  onStopTask?: (taskId: string) => void
  /** Why the last Stop did not go through, drawn under the title. */
  stopFailure?: string | null
  onClose?: () => void
}) {
  const { space } = useTheme()
  // Where the parent transcript is, from the agent's own hook. Null leaves the
  // host to find a subagent's file by its session key.
  const parentTranscriptPath = agentStatus?.providerSession?.transcriptPath ?? null
  const openTranscript = (task: BackgroundTask): (() => void) | undefined => {
    const target = subagentTranscriptTarget({ agent, task, parentTranscriptPath })
    return target ? () => openSubagentTranscript(target, task.status === 'running') : undefined
  }
  const [now, setNow] = useState(() => Date.now())
  // A roster subagent's time is the run the phone watched begin, never the
  // host's first-observed age (2026-09-20, "13h 16m" beside the desk's "1m 23s").
  const subagentRuns = useSubagentRunClock(agentStatus)
  const [runningOpen, setRunningOpen] = useState(true)
  const [finishedOpen, setFinishedOpen] = useState(true)
  const [finishedShown, setFinishedShown] = useState(FINISHED_PAGE)
  // Re-derived on each tick rather than caching elapsed separately: the walk is
  // linear over the loaded window and only runs while the sheet is open, and
  // one source of truth beats a second, staler copy of the same number.
  const { running, finished } = useMemo(
    () =>
      projectStructuredBackgroundTasks(hostBackgroundTasks, now) ??
      deriveReportedBackgroundTasks(messages, now, agentStatus, backgroundTaskReport, subagentRuns),
    [agentStatus, backgroundTaskReport, hostBackgroundTasks, messages, now, subagentRuns]
  )
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
      <MobileSheetTitleBar title="Background tasks" onClose={onClose} />
      {stopFailure ? <SheetFailureLine>{stopFailure}</SheetFailureLine> : null}
      <BackgroundTasksSection
        title="Running"
        open={runningOpen}
        onToggle={() => setRunningOpen((open) => !open)}
      >
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
              onStop={onStopTask}
              onOpen={openTranscript(task)}
            />
          ))
        ) : (
          <Txt variant="caption" tone="muted">
            Nothing running.
          </Txt>
        )}
      </BackgroundTasksSection>
      {finished.length > 0 ? (
        <BackgroundTasksSection
          title="Finished"
          count={finished.length}
          open={finishedOpen}
          onToggle={() => setFinishedOpen((open) => !open)}
        >
          {finished.slice(0, finishedShown).map((task) => (
            <BackgroundTaskCard key={task.id} task={task} onOpen={openTranscript(task)} />
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
    <View style={{ gap: space.sm, paddingTop: space.xs }}>
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
      {open ? <View style={{ gap: space.sm }}>{children}</View> : null}
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
