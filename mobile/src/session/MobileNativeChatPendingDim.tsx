import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

/** The Claude app draws an unconfirmed send at 50% alpha (`pending_message`). */
export const PENDING_SEND_DIM_OPACITY = 0.5

/** Whether a bubble is still on its way: its outbox entry is there and has not failed. */
export function pendingSendDimmed(delivery: OutboxDelivery | undefined): boolean {
  return delivery === 'sending'
}

/**
 * The first stage of a send's bubble (S2 of docs/claude-app-parity-gaps.md): dimmed while the
 * desktop has not taken it, at full strength once it has, and gone when its transcript row lands.
 *
 * "Taken" is the outbox's own word for it: a send's entry leaves the outbox when the host acks
 * the write (and, for Claude, when its check that it took the words passes) or when Claude's
 * record shows it (its prompt copy, or the row). Until then the entry is `sending`, which is also
 * what an ack-lost send held for its evidence, and a send waiting in the outbox for the desktop,
 * read as. A failed entry is drawn at full strength with its "Not sent" line under it.
 *
 * No label: the "Sending" caption was removed on 2026-10-10 ("why showing sending, that's not
 * good") and stays out until the user decides otherwise. The dim alone is the Claude app's look.
 * Opacity, not a colour, so it reads the same in Light, Dark and System. Always a View, dimmed or
 * not, so the row is not remounted when its send is taken.
 */
export function MobileNativeChatPendingDim({
  delivery,
  children
}: {
  delivery: OutboxDelivery | undefined
  children: ReactNode
}): React.JSX.Element {
  return <View style={pendingSendDimmed(delivery) ? styles.dimmed : styles.plain}>{children}</View>
}

const styles = StyleSheet.create({
  plain: { opacity: 1 },
  dimmed: { opacity: PENDING_SEND_DIM_OPACITY }
})
