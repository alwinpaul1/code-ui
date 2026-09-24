import { Pressable, View } from 'react-native'
import { Activity, ChevronRight, CircleStop, Diamond, ListTree, Terminal } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask, BackgroundTaskKind } from './mobile-background-tasks'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  formatBackgroundTaskElapsed
} from './mobile-background-task-labels'

/**
 * One task, as the Claude app's Background tasks sheet draws it (2026-09-24):
 * a raised card with the kind's glyph, the title, then the kind and its live
 * time ("Agent  39s") or how it ended ("Shell  Completed"). A running agent
 * says "View transcript" in the link colour; a finished one carries a chevron.
 * Either way the card opens what the agent did (`onOpen`); a shell has nothing
 * behind it to open. Stop is its own button, and only where the host takes one.
 */
export function MobileBackgroundTaskCard({
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
  const running = task.status === 'running'
  const frame = (pressed: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
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
          {running ? (
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
        </View>
        {onOpen && running ? (
          <Txt variant="caption" style={{ color: colors.info, marginTop: space.xs }}>
            View transcript
          </Txt>
        ) : null}
      </View>
      {onStop && running && task.stoppable !== false ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop ${task.title}`}
          onPress={() => onStop(task.id)}
          hitSlop={10}
          style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <CircleStop size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {onOpen && !running ? (
        <View style={{ alignSelf: 'center' }}>
          <ChevronRight size={18} color={colors.textMuted} />
        </View>
      ) : null}
    </Shell>
  )
}

/** One glyph per kind, so a monitor and a workflow do not both read as a
 *  shell. Plain markers in the secondary ink, as the Claude app draws them. */
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
