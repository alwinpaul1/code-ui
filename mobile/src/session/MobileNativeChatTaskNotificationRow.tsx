import type { ComponentType } from 'react'
import { StyleSheet, View } from 'react-native'
import { Check, Minus, X } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { taskNotificationsOf, type TaskNotification } from './mobile-native-chat-task-notifications'

/**
 * A background task's notification as one status line: a mark in the status's
 * colour and the task's own summary (mobile-native-chat-task-notifications.ts).
 * Not a bubble: the user did not write it. Colours come from the theme, so
 * light and dark are both the user's own setting.
 */
export function MobileNativeChatTaskNotificationRow({ notification }: { notification: TaskNotification }) {
  const { colors, space } = useTheme()
  const color =
    notification.tone === 'success' ? colors.success : notification.tone === 'danger' ? colors.danger : colors.textMuted
  const Mark = notification.tone === 'success' ? Check : notification.tone === 'danger' ? X : Minus
  return (
    <View
      style={[styles.row, { gap: space.sm, paddingVertical: space.xs }]}
      testID="native-chat-task-notification"
      accessibilityLabel={notification.summary}
    >
      <View style={styles.mark}>
        <Mark size={14} color={color} strokeWidth={2} />
      </View>
      <Txt variant="caption" tone={notification.tone === 'danger' ? 'danger' : 'secondary'} style={styles.summary}>
        {notification.summary}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  mark: { paddingTop: 2 },
  summary: { flex: 1 }
})

/** A message component that draws the task notifications a user turn carries as status rows and
 *  hands whatever else the turn holds, if anything, to `Inner` as the turn it still is. */
export function withTaskNotifications<P extends { message: NativeChatMessage }>(Inner: ComponentType<P>) {
  return function MessageOrNotifications(props: P) {
    const split = taskNotificationsOf(props.message)
    if (!split) {
      return <Inner {...props} />
    }
    return (
      <>
        {split.notifications.map((notification, index) => (
          <MobileNativeChatTaskNotificationRow key={index} notification={notification} />
        ))}
        {split.rest ? <Inner {...props} message={split.rest} /> : null}
      </>
    )
  }
}
