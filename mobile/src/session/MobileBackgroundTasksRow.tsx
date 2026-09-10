import { Pressable } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { formatRunningTaskCount } from './mobile-background-tasks'

/** "✳ 2 running tasks" under the last message, in the accent, opening the
 *  background-tasks sheet. Renders nothing when the agent has nothing in
 *  flight — which on a terminal-driven tab is always the case for agents that
 *  record no background tasks in their transcript (Codex). A structured tab
 *  counts the host's own roster instead, and that covers both agents. */
export function MobileBackgroundTasksRow({
  runningCount,
  onPress
}: {
  runningCount: number
  onPress: () => void
}) {
  const { colors, radius, space } = useTheme()
  if (runningCount <= 0) {
    return null
  }
  const label = formatRunningTaskCount(runningCount)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open background tasks`}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs + 2,
        marginHorizontal: space.md,
        marginTop: space.xs,
        marginBottom: space.sm,
        paddingVertical: space.xs,
        paddingHorizontal: space.sm,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.accentSoft : 'transparent'
      })}
    >
      <Sparkles size={14} color={colors.accentText} />
      <Txt variant="label" weight="medium" tone="accent">
        {label}
      </Txt>
    </Pressable>
  )
}
