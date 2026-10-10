import { Pressable, StyleSheet, View } from 'react-native'
import { Txt } from '../ui/Txt'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

export const OUTBOX_STATUS_COPY = {
  sending: 'Sending…',
  failed: 'Not sent',
  retry: 'Retry',
  edit: 'Edit'
} as const

/**
 * The line under a message the outbox is still seeing through
 * (use-native-chat-outbox-recovery.ts), as a chat app draws one: "Sending…" until the desktop has
 * it, or "Not sent" with Retry and Edit when the resend could not deliver it. Colours come from
 * the theme's tones, so it follows Light, Dark and System.
 */
export function MobileNativeChatOutboxStatus({
  delivery,
  onRetry,
  onEdit
}: {
  delivery: OutboxDelivery
  onRetry?: () => void
  onEdit?: () => void
}): React.JSX.Element {
  if (delivery === 'sending') {
    return (
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Txt variant="caption" tone="muted">
          {OUTBOX_STATUS_COPY.sending}
        </Txt>
      </View>
    )
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
