import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { offerOutboxAdoption, recordOutboxSend, releaseOutboxSendBeforeWrite } from './native-chat-outbox-sends'

/** A composer text send whose box emptied and whose bubble was drawn at the tap. */
export type NativeChatTextSendStart = {
  /** Handed to the message send (MobileNativeChatSendFollow `origin`), so the whole press is one
   *  origin: one outbox entry, one bubble, and one give-back. */
  readonly origin: MobileNativeChatSendOrigin
  /** A refusal before anything was typed: the words back in the composer, the bubble down, the
   *  entry out once the words have landed. Once per press; a no-op after a hand-over. */
  readonly giveBack: () => void
  /** A refusal the outbox can see through (no input box on the desktop, the desktop not there):
   *  the entry is handed over and the bubble stays. False, with nothing changed, when nothing
   *  could send it later; the caller then gives the words back. */
  readonly handOver: () => boolean
}

/**
 * Empties the composer and draws the message's bubble at the tap, before the send looks at the
 * desktop screen, as the Claude app draws its pending row in the frame of the tap
 * (docs/claude-app-parity-gaps.md §3).
 *
 * Why: a terminal tab's send looked at the screen first (a dialog there takes typed keys as
 * answers) and only then let the box empty: a terminal.read over the relay at the least, and up to
 * three reads 400 ms apart while Claude repaints its box (readSendUnderDialogRefusal), then the
 * draft mirror's flush. The words sat in the box and no bubble showed for all of it ("when a
 * message is sent from the composer it takes time to appear", 2026-10-17).
 *
 * Only for a send that can go now (the caller asks the gate first): one that has to wait for the
 * link keeps its words in the composer while it waits (S4, native-chat-send-gate-outbox.ts), and
 * only for a chat with a session, where the bubble can be drawn.
 *
 * The entry is written before the box empties, as a send's own, not `atGate`: the words are out
 * of the composer, so a process that dies during the look must find them in the outbox, never
 * drop them as a gate entry is dropped. Null, with nothing changed, when it cannot start this way.
 */
export function beginTextSendAtTapWith(
  drafts: {
    captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
    clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
    restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
    showSendingEcho: (origin: MobileNativeChatSendOrigin) => void
  },
  text: string
): NativeChatTextSendStart | null {
  if (text.trim() === '') {
    return null
  }
  const origin = drafts.captureSendOrigin(text.trimEnd())
  if (!origin?.outboxId || !origin.pendingKey) {
    return null
  }
  if (origin.outboxRecovery) {
    // A recovery resend of these words is being made: its offer goes back for it to take.
    offerOutboxAdoption(origin.draftKey, origin.normalizedText, origin.outboxId, true)
    return null
  }
  recordOutboxSend(origin, text)
  origin.boxEmptiedAtTap = true
  drafts.clearDraftForSend(origin, text)
  drafts.showSendingEcho(origin)
  return {
    origin,
    giveBack: () => {
      // restoreRejectedDraft keeps it to once (wordsPlaced) and takes the bubble down (echoDrawn).
      drafts.restoreRejectedDraft(origin, text)
    },
    handOver: () => handOverTextSendStartedAtTap(origin)
  }
}

/** The hand-over of a send whose box emptied at the tap (NativeChatTextSendStart `handOver`),
 *  for the message send's own gate too (native-chat-send-gate-outbox.ts). */
export function handOverTextSendStartedAtTap(origin: MobileNativeChatSendOrigin): boolean {
  if (origin.wordsPlaced || !releaseOutboxSendBeforeWrite(origin.outboxId)) {
    return false
  }
  origin.wordsPlaced = true
  return true
}
