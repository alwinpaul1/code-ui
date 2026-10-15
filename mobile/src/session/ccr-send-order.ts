import { hydrateNativeChatOutbox, nativeChatOutboxEntries } from '../storage/native-chat-outbox'
import { CCR_ATTACHMENT_OTHER_ACCOUNT } from './ccr-attachment-send'
import { ccrEchoSeen } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import type { NativeChatOutboxCcr } from '../storage/native-chat-outbox'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { OUTBOX_MAX_RESEND_AGE_MS, OUTBOX_SESSION_AUTO_ATTEMPTS } from './native-chat-outbox-recovery-plan'
import {
  claimOutboxSend,
  isOutboxSendLive,
  offerOutboxAdoption,
  patchOutboxEntry,
  retireOutboxSend,
  takeOutboxAdoption,
  unclaimOutboxSend
} from './native-chat-outbox-sends'
import { ccrSessionTail, sameCcrTarget, type CcrTo } from './use-ccr-tab-queues'

/**
 * One POST at a time on a Claude tab's Anthropic lane, and in the order the words were typed
 * (use-ccr-composer-send.ts). Second review of 5da46b13b, 2026-10-15:
 *
 *  - The in-flight guard refused the outbox's own resend of a message a killed app left behind
 *    while the user's new send was out, and the recovered message said "Not sent" with "Another
 *    input is still being sent" over words the user never touched. A resend waits instead
 *    (`CcrSendFlight.idle`); only the user's own press is refused by a send in flight.
 *  - A message sent after the relaunch, or a queue sent at a turn's end, posted ahead of the
 *    recovered one, which was still waiting for the outbox's idle settle. A send now posts the
 *    tab's older entries first (`sendOlderCcrEntriesFirst`).
 */

/** What is in flight: a send between its first check and its POST (`claimed`, its status read is
 *  awaited there), and the POSTs out now (the app's "a send already in flight"). */
export class CcrSendFlight {
  claimed = false
  private posts = 0
  private waiters: (() => void)[] = []

  busy(): boolean {
    return this.claimed || this.posts > 0
  }

  /** Resolves once nothing is in flight: the outbox's resend waits here rather than be refused. */
  async idle(): Promise<void> {
    while (this.busy()) {
      await new Promise<void>((wake) => this.waiters.push(wake))
    }
  }

  /** The claim is over. */
  release(): void {
    this.claimed = false
    this.wake()
  }

  /** One POST, counted while it is out. */
  async posting<T>(post: () => Promise<T>): Promise<T> {
    this.posts += 1
    try {
      return await post()
    } finally {
      this.posts -= 1
      this.wake()
    }
  }

  /** `run` under the claim, so nothing else starts beside it. */
  async claim<T>(run: () => Promise<T>): Promise<T> {
    this.claimed = true
    try {
      return await run()
    } finally {
      this.release()
    }
  }

  private wake(): void {
    if (this.busy()) {
      return
    }
    for (const wake of this.waiters.splice(0)) {
      wake()
    }
  }
}

/** The outbox's resend of `uuid`, once nothing is in flight: whether the stream already carries it
 *  (its first copy arrived, so nothing is posted again; the echo is keyed by uuid, never text). */
export async function ccrResendLanded(flight: CcrSendFlight, events: () => readonly CcrEvent[], uuid: string): Promise<boolean> {
  await flight.idle()
  return ccrEchoSeen(events(), uuid)
}

/**
 * The messages this tab left in the outbox for `to` before `origin`'s (a killed app's, waiting
 * for the outbox's idle settle), posted now, oldest first, so the words typed since go after
 * them. Each is claimed as the outbox's own resend claims it, counted on disk before it goes, and
 * resent under its own uuid through `sendNow`; one whose echo is already on the stream is retired
 * unposted. One refused is marked "Not sent" as the outbox marks it, and the send goes on: an old
 * failure never holds the new words back. Spent, day-old, failed and photo entries stay the
 * outbox's. Resolves false when one is being carried by another send right now (the outbox's
 * resend between its claim and its POST): the caller is then a send in flight.
 */
export async function sendOlderCcrEntriesFirst(args: {
  origin: MobileNativeChatSendOrigin
  to: CcrTo
  events: () => readonly CcrEvent[]
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  sendNow: (text: string, origin: MobileNativeChatSendOrigin, to: CcrTo, uuid: string) => Promise<MobileNativeChatSendOutcome>
  log: (line: string) => void
}): Promise<boolean> {
  const { origin, to } = args
  await hydrateNativeChatOutbox()
  const now = Date.now()
  const older = nativeChatOutboxEntries()
    .filter(
      (entry) =>
        entry.draftKey === origin.draftKey &&
        entry.id !== origin.outboxId &&
        entry.ccr !== undefined &&
        sameCcrTarget(to, entry.ccr) &&
        (entry.pendingKey === null || origin.pendingKey === null || entry.pendingKey === origin.pendingKey) &&
        !entry.failed &&
        !entry.hasAttachments &&
        entry.autoAttempts < OUTBOX_SESSION_AUTO_ATTEMPTS &&
        now - entry.createdAt <= OUTBOX_MAX_RESEND_AGE_MS
    )
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const entry of older) {
    const uuid = entry.ccr!.uuid
    if (ccrEchoSeen(args.events(), uuid)) {
      void retireOutboxSend(entry.id)
      continue
    }
    if (!claimOutboxSend(entry.id)) {
      return false
    }
    try {
      if (!(await patchOutboxEntry(entry.id, { autoAttempts: entry.autoAttempts + 1, lastAttemptAt: Date.now(), failed: undefined, hostAcked: undefined }))) {
        void patchOutboxEntry(entry.id, { failed: true })
        continue
      }
      offerOutboxAdoption(entry.draftKey, entry.normalizedText, entry.id, true)
      const resent = args.captureSendOrigin(entry.text)
      takeOutboxAdoption(entry.draftKey, entry.normalizedText)
      if (resent?.outboxId !== entry.id) {
        args.log('[ccr-send] an older message on this tab could not be resent ahead of the new one; the outbox keeps it')
        continue
      }
      args.log(`[ccr-send] resending an older message this tab left in the outbox, ahead of the new one, to session ${ccrSessionTail(to.sessionId)}`)
      await args.sendNow(entry.text, resent, to, uuid)
    } finally {
      if (isOutboxSendLive(entry.id)) {
        unclaimOutboxSend(entry.id)
      }
    }
  }
  return true
}

/** Why a send to `to` must be refused before anything is posted, as [log line, user notice], or
 *  null to go on: files uploaded under another account than the session's (the desktop reads a
 *  file with the session account's own sign-in), or an outbox resend whose tab now sends to
 *  another session than the one it was written for. */
export function ccrSendTargetRefusal(to: CcrTo, pinned: NativeChatOutboxCcr | undefined, filesAccountId: string | null): [string, string] | null {
  if (filesAccountId !== null && filesAccountId !== to.accountId) {
    return [`[ccr-send] refused: attachments were uploaded under another account than session ${ccrSessionTail(to.sessionId)}'s`, CCR_ATTACHMENT_OTHER_ACCOUNT]
  }
  if (pinned && !sameCcrTarget(to, pinned)) {
    return [
      `[ccr-send] outbox resend refused: written for session ${ccrSessionTail(pinned.sessionId)}, this tab now sends to ${ccrSessionTail(to.sessionId)}`,
      'Message not sent: this tab now sends to another session than the one it was written for.'
    ]
  }
  return null
}
