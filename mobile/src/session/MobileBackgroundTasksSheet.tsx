import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Pressable, View } from 'react-native'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Diamond,
  ListTree,
  Square,
  Terminal
} from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  deriveBackgroundTasks,
  type BackgroundTaskHostStatus,
  type BackgroundTaskKind,
  type BackgroundTask
} from './mobile-background-tasks'
import { useSubagentRunClock } from './use-subagent-run-clock'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'
import { formatBackgroundTaskElapsed, backgroundTaskKindLabel, backgroundTaskStatusLabel } from './mobile-background-task-labels'
import { subagentTranscriptTarget } from './mobile-subagent-transcript'
import { openSubagentTranscript } from './subagent-transcript-store'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

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
  onStopTask?: (taskId: string) => void
  onClose: () => void
}) {
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss>
      <MobileBackgroundTasksSheetBody
        messages={messages}
        agent={agent}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        onStopTask={onStopTask}
      />
    </BottomDrawer>
  )
}

/** The sheet's contents, exported so render tests can mount them without the
 *  drawer's gesture/animation stack. */
export function MobileBackgroundTasksSheetBody({
  messages,
  agent = null,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopTask
}: {
  messages: readonly NativeChatMessage[]
  agent?: string | null
  agentStatus?: BackgroundTaskHostStatus | null
  backgroundTaskReport?: ActiveTabBackgroundTaskReport
  hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
  onStopTask?: (taskId: string) => void
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
      deriveBackgroundTasks(messages, now, agentStatus ?? null, {
        finishedTaskIds: backgroundTaskReport?.finishedTaskIds ?? [],
        runningTaskIds: backgroundTaskReport?.runningTaskIds ?? null,
        runningTaskIdsAt: backgroundTaskReport?.runningTaskIdsAt ?? null,
        launchedTaskIds: backgroundTaskReport?.launchedTaskIds ?? [],
        onScreenShellCount: backgroundTaskReport?.onScreenShellCount ?? null,
        subagentRuns
      }),
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
    <Surface rounded="lg" style={{ padding: space.md + 2, gap: space.sm }}>
      <Txt variant="body" weight="medium">
        Background tasks
      </Txt>
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
    </Surface>
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
        {open ? (
          <ChevronDown size={16} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={16} color={colors.textSecondary} />
        )}
        <Txt variant="label" weight="medium" tone="secondary">
          {heading}
        </Txt>
      </Pressable>
      {open ? <View style={{ gap: space.sm }}>{children}</View> : null}
    </View>
  )
}

/** One task. A Claude subagent's card is a tap target that opens what the
 *  agent did (`onOpen`); every other kind is a plain row, because there is
 *  nothing behind a shell to open. The stop control stays its own button. */
function BackgroundTaskCard({
  task,
  onStop,
  onOpen
}: {
  task: BackgroundTask
  onStop?: (taskId: string) => void
  onOpen?: () => void
}) {
  const { colors, radius, space } = useTheme()
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs)
  const frame = (pressed: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: space.sm,
    padding: space.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.bgSunken : colors.bgRaised
  })
  const Shell = onOpen ? Pressable : View
  return (
    <Shell
      {...(onOpen
        ? {
            accessibilityRole: 'button' as const,
            accessibilityLabel: `Open ${task.title}`,
            accessibilityHint: 'Shows what this agent did',
            onPress: onOpen,
            style: ({ pressed }: { pressed: boolean }) => frame(pressed)
          }
        : { style: frame(false) })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bgSunken
        }}
      >
        <BackgroundTaskGlyph kind={task.kind} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" numberOfLines={2}>
          {task.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="caption" tone="muted">
            {backgroundTaskKindLabel(task.kind)}
          </Txt>
          {task.status === 'running' ? (
            elapsed ? (
              <Txt variant="caption" tone="secondary">
                {elapsed}
              </Txt>
            ) : null
          ) : (
            <Txt
              variant="caption"
              weight="medium"
              tone={task.status === 'failed' ? 'danger' : 'secondary'}
            >
              {backgroundTaskStatusLabel(task.status)}
            </Txt>
          )}
        </View>
      </View>
      {onStop && task.status === 'running' && task.stoppable !== false ? (
        <StopTaskButton taskId={task.id} title={task.title} onStop={onStop} />
      ) : null}
      {onOpen ? (
        <View style={{ alignSelf: 'center' }}>
          <ChevronRight size={16} color={colors.textMuted} />
        </View>
      ) : null}
    </Shell>
  )
}

/** One glyph per kind, so a monitor and a workflow do not both read as a
 *  shell. Only the agent glyph takes the accent; the rest are plain markers. */
function BackgroundTaskGlyph({ kind }: { kind: BackgroundTaskKind }) {
  const { colors } = useTheme()
  switch (kind) {
    case 'agent':
      return <Diamond size={14} color={colors.accentText} />
    case 'monitor':
      return <Activity size={14} color={colors.textSecondary} />
    case 'workflow':
      return <ListTree size={14} color={colors.textSecondary} />
    case 'shell':
    case 'unknown':
      return <Terminal size={14} color={colors.textSecondary} />
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

function StopTaskButton({
  taskId,
  title,
  onStop
}: {
  taskId: string
  title: string
  onStop: (taskId: string) => void
}) {
  const { colors, radius } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Stop ${title}`}
      onPress={() => onStop(taskId)}
      hitSlop={8}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgSunken : 'transparent'
      })}
    >
      <Square size={12} color={colors.textSecondary} fill={colors.textSecondary} />
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
