import { View } from 'react-native'
import { Activity, Diamond, ListTree, Terminal } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask, BackgroundTaskKind } from './mobile-background-tasks'
import { MobileWorkflowCard } from './MobileWorkflowCard'
import { MobileBackgroundTaskStopButton } from './MobileBackgroundTaskStopButton'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  formatBackgroundTaskElapsed,
  formatTokenCount
} from './mobile-background-task-labels'

/**
 * One task, as the Claude Android app's Background tasks sheet draws it (screenshot, 2026-10-10): a
 * card darker than the sheet with the kind's glyph, the title in body text (two lines at most), then
 * the kind and its live time ("Shell  41s") or how it ended ("Shell  Completed"). A running card
 * carries a round Stop at its top right where the host takes one; a finished card has none. The card
 * itself opens nothing: the fork's "View transcript" link is gone (2026-10-10, not in Orca).
 */
export function MobileBackgroundTaskCard({
  task,
  onStop,
  stopHeld = false,
  statusUnknown = false
}: {
  task: BackgroundTask
  onStop?: (taskId: string) => void
  /** A Stop is on its way, or the host confirmed it and the row has not left yet (Orca #26780). */
  stopHeld?: boolean
  /** No connection to the host: a running row cannot say it runs, so its time reads "Status
   *  unknown" and it takes no Stop. */
  statusUnknown?: boolean
}) {
  const { colors, radius, space } = useTheme()
  if (task.workflow) {
    return <MobileWorkflowCard task={task} onStop={onStop} stopHeld={stopHeld} />
  }
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs)
  const running = task.status === 'running'
  return (
    <View
      testID="background-task-card"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        borderRadius: radius.lg,
        backgroundColor: colors.bgSunken
      }}
    >
      <View style={{ height: 22, justifyContent: 'center' }}>
        <BackgroundTaskGlyph kind={task.kind} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" weight="medium" numberOfLines={2}>
          {task.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Txt variant="caption" tone="secondary">
            {backgroundTaskKindLabel(task.kind)}
          </Txt>
          {running && statusUnknown ? (
            <Txt variant="caption" tone="muted">
              Status unknown
            </Txt>
          ) : running ? (
            elapsed ? (
              <Txt variant="caption" tone="muted">
                {elapsed}
              </Txt>
            ) : null
          ) : (
            <Txt variant="caption" tone={task.status === 'failed' ? 'danger' : 'muted'}>
              {backgroundTaskStatusLabel(task.status)}
            </Txt>
          )}
          {task.totalTokens !== undefined && !(running && statusUnknown) ? (
            <Txt variant="caption" tone="muted">
              {`${formatTokenCount(task.totalTokens)} tokens`}
            </Txt>
          ) : null}
        </View>
      </View>
      {onStop && running && !statusUnknown && task.stoppable !== false ? (
        <MobileBackgroundTaskStopButton title={task.title} held={stopHeld} onPress={() => onStop(task.id)} />
      ) : null}
    </View>
  )
}

/** One glyph per kind: a console for a shell, the hollow diamond for an agent, and their own for a
 *  monitor and a workflow, so neither reads as a shell. Plain markers in the secondary ink. */
function BackgroundTaskGlyph({ kind }: { kind: BackgroundTaskKind }) {
  const { colors } = useTheme()
  switch (kind) {
    case 'agent':
      return <Diamond size={12} color={colors.textSecondary} />
    case 'monitor':
      return <Activity size={16} color={colors.textSecondary} />
    case 'workflow':
      return <ListTree size={16} color={colors.textSecondary} />
    case 'shell':
    case 'unknown':
      return <Terminal size={16} color={colors.textSecondary} />
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
