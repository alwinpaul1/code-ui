import { View } from 'react-native'
import { MobileBackgroundTaskStopButton } from './MobileBackgroundTaskStopButton'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask } from './mobile-background-tasks'
import type { WorkflowDetail } from './mobile-background-task-workflows'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  formatAgentCount,
  formatBackgroundTaskElapsed,
  formatTokenCount
} from './mobile-background-task-labels'

/**
 * One Workflow, drawn after the Claude app's card (reference frames
 * 2026-09-30): a status dot and the workflow's name, "Workflow" and the time,
 * the agent figures, the description, then the phases.
 *
 * Only what the phone can know is drawn (docs/mobile-background-tasks.md, "A
 * Workflow is one task"). The runner starts its agents inline, so the roster's
 * lane rows carry no label, no phase, no tokens and vanish when an agent ends:
 * the phases are the meta's titles alone, with no counts, squares or agent
 * rows, and a running card says how many lanes are running only when it can
 * show they are this workflow's. The totals (agents, tokens, failures, time)
 * come from the workflow's own completion notification.
 */
export function MobileWorkflowCard({
  task,
  onStop,
  stopHeld = false,
  statusUnknown = false
}: {
  task: BackgroundTask
  onStop?: (taskId: string) => void
  stopHeld?: boolean
  /** No connection to the host: a running workflow's time reads "Status unknown", with no Stop. */
  statusUnknown?: boolean
}) {
  const { colors, radius, space } = useTheme()
  const detail = task.workflow
  if (!detail) {
    return null
  }
  const running = task.status === 'running'
  const dot = running ? colors.info : task.status === 'failed' ? colors.danger : colors.textMuted
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs ?? detail.usage?.durationMs ?? null)
  return (
    <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.bgSunken }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
        <Txt variant="body" weight="medium" numberOfLines={2} style={{ flex: 1 }}>
          {task.title}
        </Txt>
        {onStop && running && !statusUnknown && task.stoppable !== false ? (
          <MobileBackgroundTaskStopButton title={task.title} held={stopHeld} onPress={() => onStop(task.id)} />
        ) : null}
      </View>
      <Facts>
        <Txt variant="caption" tone="secondary">
          {backgroundTaskKindLabel(task.kind)}
        </Txt>
        {running ? null : (
          <Txt variant="caption" tone={task.status === 'failed' ? 'danger' : 'muted'}>
            {backgroundTaskStatusLabel(task.status)}
          </Txt>
        )}
        {running && statusUnknown ? (
          <Txt variant="caption" tone="muted">
            Status unknown
          </Txt>
        ) : elapsed ? (
          <Txt variant="caption" tone="muted">
            {elapsed}
          </Txt>
        ) : null}
      </Facts>
      <AgentFigures detail={detail} running={running} />
      {detail.description ? (
        <Txt variant="caption" tone="secondary">
          {detail.description}
        </Txt>
      ) : null}
      {detail.phases !== null && detail.phases.length > 0 ? (
        <View style={{ gap: space.xs, paddingTop: space.sm }}>
          <Txt variant="label" weight="semibold">
            Phases
          </Txt>
          {detail.phases.map((phase, index) => (
            // Keyed by place: a meta may repeat a title.
            <Txt key={index} variant="body" tone="secondary">
              {phase.title}
            </Txt>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Facts({ children }: { children: React.ReactNode }) {
  const { space } = useTheme()
  // Wraps: four captions at a large font scale on a 360dp phone run past a row.
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.xs }}>{children}</View>
}

/** Running: the lanes counted now, or nothing. Finished: the totals the
 *  notification stated, each only when it stated it. */
function AgentFigures({ detail, running }: { detail: WorkflowDetail; running: boolean }) {
  const { lanes, usage } = detail
  if (running) {
    return lanes ? (
      <Facts>
        <Txt variant="caption" tone="secondary">
          {`${lanes.count}${lanes.atLeast ? '+' : ''} agent${lanes.count === 1 && !lanes.atLeast ? '' : 's'} running`}
        </Txt>
      </Facts>
    ) : null
  }
  if (!usage) {
    return null
  }
  const parts: { text: string; danger?: boolean }[] = []
  if (usage.agents !== null) {
    parts.push({ text: formatAgentCount(usage.agents) })
  }
  if (usage.tokens !== null) {
    parts.push({ text: `${formatTokenCount(usage.tokens)} tokens` })
  }
  if (usage.failed) {
    parts.push({ text: `${usage.failed} failed`, danger: true })
  }
  if (usage.skipped) {
    parts.push({ text: `${usage.skipped} skipped` })
  }
  return parts.length === 0 ? null : (
    <Facts>
      {parts.map((part) => (
        <Txt key={part.text} variant="caption" tone={part.danger ? 'danger' : 'secondary'}>
          {part.text}
        </Txt>
      ))}
    </Facts>
  )
}
