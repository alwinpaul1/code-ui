import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { formatRunningTaskCount } from './mobile-background-task-labels'

/**
 * "✳ Cooking… · 1 running task" above the composer while the agent works —
 * the Claude app's status line (2026-09-12). The verb is the agent's own,
 * read off its spinner; "Working" when the screen shows none. The task count
 * opens the background-tasks sheet.
 */
export function MobileNativeChatActivityLine({
  verb,
  runningTaskCount,
  onOpenBackgroundTasks
}: {
  verb: string | null
  runningTaskCount: number
  onOpenBackgroundTasks?: () => void
}) {
  const { colors, space } = useTheme()
  const label = `${verb ?? 'Working'}…`
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs }}
      accessibilityLiveRegion="polite"
    >
      <Txt variant="body" weight="semibold" style={{ color: colors.accent }}>
        ✳
      </Txt>
      <Txt variant="body" weight="medium" style={{ color: colors.accent }}>
        {label}
      </Txt>
      {runningTaskCount > 0 ? (
        <Pressable
          onPress={onOpenBackgroundTasks}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${formatRunningTaskCount(runningTaskCount)}. Open background tasks`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
        >
          <Txt variant="body" tone="muted">
            ·
          </Txt>
          <Txt variant="body" weight="medium" style={{ color: colors.info ?? colors.accentText }}>
            {formatRunningTaskCount(runningTaskCount)}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}
