import { Pressable, Text, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { formatRunningTaskCount } from './mobile-background-task-labels'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import { MobileBackgroundTasksPulse } from './MobileBackgroundTasksPulse'
import { useNativeChatTasks } from './native-chat-tasks-context'

/**
 * The line above the composer, as the Claude app draws it (2026-09-24):
 *
 *   ✳ Cooking… · 5 running tasks
 *   ✳ 1m 16s · 5 running tasks · thinking some more…
 *   ✳ 5 running tasks                      (turn over, tasks still running)
 *
 * The verb, the time and the thinking status are the agent's own, read off
 * its spinner line; with no spinner on screen (Codex, or a Claude screen not
 * yet read) the verb is "Working". The count is the background-task reader's
 * and opens the sheet. Nothing is drawn when the agent is idle with nothing
 * running.
 */
export function MobileNativeChatStatusLine({
  working,
  spinner
}: {
  /** Whether this line should say the agent is working. False on the
   *  structured lane, whose per-turn row already says it. */
  working: boolean
  spinner: ClaudeSpinner | null
}) {
  const { colors, fonts, space, type } = useTheme()
  const { runningCount, openSheet } = useNativeChatTasks()
  if (!working && runningCount <= 0) {
    return null
  }
  const text = { fontFamily: fonts.regular, fontSize: type.label.size, lineHeight: type.label.lineHeight }
  const dot = <Text style={[text, { color: colors.textMuted }]}>{' · '}</Text>
  const lead = working
    ? spinner?.elapsed
      ? <Text style={[text, { color: colors.textMuted }]}>{spinner.elapsed}</Text>
      : <Text style={[text, { fontFamily: fonts.medium, color: colors.accentText }]}>{`${spinner?.verb ?? 'Working'}…`}</Text>
    : null
  const count = formatRunningTaskCount(runningCount)
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, flexShrink: 1 }}
      accessibilityLiveRegion="polite"
      testID="native-chat-status-line"
    >
      <MobileBackgroundTasksPulse color={colors.accentText} />
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        {lead}
        {runningCount > 0 ? (
          <>
            {lead ? dot : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${count}. Open background tasks`}
              onPress={openSheet}
              hitSlop={10}
            >
              <Text style={[text, { fontFamily: fonts.medium, color: colors.info }]}>{count}</Text>
            </Pressable>
          </>
        ) : null}
        {working && spinner?.thinking ? (
          <Text style={[text, { color: colors.textMuted, flexShrink: 1 }]} numberOfLines={1}>
            {` · ${spinner.thinking}…`}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
