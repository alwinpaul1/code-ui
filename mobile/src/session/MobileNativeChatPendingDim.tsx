import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

/** The Claude app draws an unconfirmed send at 50% alpha (`pending_message`). */
export const PENDING_SEND_DIM_OPACITY = 0.5

/** Whether a bubble is still on its way to the desktop: its outbox entry is there, has not
 *  failed, and the desktop has not answered its write yet. */
export function pendingSendDimmed(delivery: OutboxDelivery | undefined): boolean {
  return delivery === 'sending'
}

/**
 * The first stage of a send's bubble (S2 of docs/claude-app-parity-gaps.md): dimmed until the
 * desktop acks the send, at full strength from then, and gone when its transcript row lands.
 *
 * The Claude app dims its pending row only until its POST is acked (a 2xx, near-instant) and draws
 * it normally while it waits for the echo. The phone's ack is the desktop answering the body write
 * (`terminal.send`, the outbox entry's `hostAcked`) or accepting the structured operation (the
 * entry leaves the outbox there). Until 2026-10-12 the dim lasted until Claude had the message on
 * record, which on a send whose check could not settle was the whole 20 s hold: the linger the
 * "Sending" label was removed for. The outbox still keeps the entry until Claude's record shows
 * it (delivery on record, docs/mobile-chat-outbox.md); only the look ends at the ack. A send whose
 * ack never came (held as unconfirmed) and one waiting in the outbox for the desktop stay dimmed:
 * nothing says the desktop has them. A failed entry is drawn at full strength with its "Not sent"
 * line under it.
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
