import { Pressable, StyleSheet, View } from 'react-native'
import { Txt } from '../ui/Txt'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

export const OUTBOX_STATUS_COPY = {
  failed: 'Not sent',
  retry: 'Retry',
  edit: 'Edit'
} as const

/**
 * The line under a message the outbox is still seeing through
 * (use-native-chat-outbox-recovery.ts): "Not sent" with Retry and Edit when the resend could not
 * deliver it, and nothing at all while it is on its way. A "Sending…" label drew there until
 * 2026-10-10 and the user did not want it ("why showing sending, that's not good"): the bubble
 * alone says the message went, as a normal sent message does. Colours come from the theme's
 * tones, so it follows Light, Dark and System.
 */
export function MobileNativeChatOutboxStatus({
  delivery,
  onRetry,
  onEdit
}: {
  delivery: OutboxDelivery
  onRetry?: () => void
  onEdit?: () => void
}): React.JSX.Element | null {
  if (delivery === 'sending') {
    return null
  }
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Txt variant="caption" tone="danger">
        {OUTBOX_STATUS_COPY.failed}
      </Txt>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8} style={styles.action}>
          <Txt variant="caption" weight="semibold" tone="accent">
            {OUTBOX_STATUS_COPY.retry}
          </Txt>
        </Pressable>
      ) : null}
      {onEdit ? (
        <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8} style={styles.action}>
          <Txt variant="caption" weight="semibold" tone="secondary">
            {OUTBOX_STATUS_COPY.edit}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 8
  },
  action: {
    paddingVertical: 2
  }
})
