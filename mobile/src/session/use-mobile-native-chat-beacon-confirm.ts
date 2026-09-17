import { useEffect, type MutableRefObject } from 'react'
import {
  findBeaconConfirmedSends,
  type BeaconPromptReceipt
} from './mobile-native-chat-beacon-confirm'

export type { BeaconPromptReceipt }
import type { UnconfirmedSend } from './mobile-native-chat-draft-reconcile'

/**
 * Stops the unconfirmed-send clock on the agent's own prompt receipt.
 *
 * The same clock the transcript effect stops, stopped earlier: an ack-lost send
 * otherwise waits the full `UNCONFIRMED_SEND_DEADLINE_MS` (20 s) for a
 * transcript row, while the agent's `UserPromptSubmit` hook beacons the text it
 * accepted in about a second. The row it replaces is matched against a painted
 * screen that wraps and truncates; this is the agent's own bytes.
 *
 * Confirm only. The held entry is dropped and its deadline cleared, so the send
 * stops being "unconfirmed" — the pending BUBBLE is untouched and still leaves
 * only when a transcript row claims it. Retiring it here would be the
 * 2026-09-13 vanishing-message defect: a mid-turn send's only record is the
 * `queued_command` attachment Orca's reader drops, so there would be no row to
 * replace it and it would simply disappear.
 *
 * Absent receipts (a hand-started session, Windows, an older build) degrade to
 * exactly today's behaviour, never to a false confirmation.
 */
export function useMobileNativeChatBeaconConfirm(input: {
  unconfirmedRef: MutableRefObject<UnconfirmedSend[]>
  draftKey: string | null
  pendingKey: string | null
  /** The drafts hook's own args, so its call site stays one line. */
  args: {
    beaconPromptReceipts?: readonly BeaconPromptReceipt[]
    onUnconfirmedSendLanded?: () => void
  }
}): void {
  const { unconfirmedRef, draftKey, pendingKey } = input
  const beaconPromptReceipts = input.args.beaconPromptReceipts
  const onConfirmed = input.args.onUnconfirmedSendLanded
  useEffect(() => {
    if (!draftKey || !beaconPromptReceipts || beaconPromptReceipts.length === 0) {
      return
    }
    if (unconfirmedRef.current.length === 0) {
      return
    }
    const relevant = unconfirmedRef.current.filter(
      (entry) =>
        entry.draftKey === draftKey &&
        (entry.pendingKey === null || entry.pendingKey === pendingKey)
    )
    const confirmed = findBeaconConfirmedSends(beaconPromptReceipts, relevant)
    if (confirmed.length === 0) {
      return
    }
    const confirmedSet = new Set(confirmed)
    unconfirmedRef.current = unconfirmedRef.current.filter((entry) => !confirmedSet.has(entry))
    for (const entry of confirmed) {
      clearTimeout(entry.deadline ?? undefined)
    }
    onConfirmed?.()
  }, [beaconPromptReceipts, draftKey, pendingKey, onConfirmed, unconfirmedRef])
}
