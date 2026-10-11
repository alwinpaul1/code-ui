import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { MobileNativeChatSendUnready } from './mobile-native-chat-send-readiness'
import type { MobileNativeChatSendErrorDetails } from './use-mobile-native-chat-send-error'
import { passOutboxGate, recordOutboxSend, releaseOutboxSendFromGate, retireOutboxSend } from './native-chat-outbox-sends'
import {
  SEND_SCREEN_UNAVAILABLE_REFUSAL,
  SEND_SCREEN_UNREADABLE_REFUSAL,
  SEND_WITHOUT_CODEX_COMPOSER_REFUSAL,
  SEND_WITHOUT_COMPOSER_REFUSAL
} from './mobile-native-chat-dialog-guard'

/** What a send the gate refused for want of the desktop says when the outbox keeps it. */
export const SEND_WAITS_FOR_DESKTOP = 'Message waits for your desktop: it is sent when the connection is back'

/** A look that found no input box to type into, and what the send says instead once the outbox
 *  keeps it: the drainer types only when the box is back (observeTerminalOutboxEntry). */
export const INPUT_BOX_REFUSALS: ReadonlyMap<string, string> = new Map([
  [SEND_WITHOUT_COMPOSER_REFUSAL, "Claude's input box isn't on the desktop screen. The message will send when it is back."],
  [SEND_WITHOUT_CODEX_COMPOSER_REFUSAL, "Codex's input box isn't on the desktop screen. The message will send when it is back."],
  [SEND_SCREEN_UNAVAILABLE_REFUSAL, 'The desktop has no screen for this terminal yet. The message will send when it has.'],
  [SEND_SCREEN_UNREADABLE_REFUSAL, "Couldn't read the desktop screen. The message will send when it can be read."]
])

/**
 * A composer text send refused before anything was written, handed to the outbox instead of
 * failing (S4): written down, given to the drainer or the chat's recovery, the box emptied and
 * the bubble drawn. False, with nothing changed, when the outbox cannot see it through (no route,
 * no drainer, no chat): the caller then says the refusal with a Retry (S5).
 */
export function parkRefusedComposerSend(args: {
  text: string
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  showSendingEcho?: (origin: MobileNativeChatSendOrigin) => void
}): boolean {
  const origin = args.captureSendOrigin(args.text.trimEnd())
  if (!origin?.outboxId || origin.outboxRecovery || args.text.trim() === '') {
    return false
  }
  recordOutboxSend(origin, args.text, { atGate: true })
  if (!releaseOutboxSendFromGate(origin.outboxId)) {
    void retireOutboxSend(origin.outboxId)
    return false
  }
  args.clearDraftForSend(origin, args.text)
  args.showSendingEcho?.(origin)
  return true
}

/**
 * A composer text send's outbox entry around the send gate (S4), and how a send refused before
 * anything was written says so (S5).
 *
 * Until 2026-10-11 the entry was written after the gate, so a send the gate refused (the relay
 * down for its whole 15 s budget, the desktop asleep) never reached the outbox: its words went
 * back with a notice and nothing sent them later. Now:
 *
 * - `enter`, before the gate: the entry is written, marked `atGate` (the words are still in the
 *   composer, so a process that dies here leaves them there and the entry is dropped on the next
 *   read, never sent beside them).
 * - `pass`, through the gate: the mark comes off, as the composer empties.
 * - `refuse`: the gate wanted the desktop and the outbox can send it later (the app-wide drainer,
 *   or this chat's recovery) — the box empties, the bubble is drawn, and the notice says it waits
 *   (outcome 'unknown': nothing is put back). Anything else is a refusal before any write: the
 *   entry leaves the outbox, the words stay in the composer (they never left it), and the notice
 *   carries a Retry, as the Claude app's snackbar does, unless retrying cannot help (the tab moved
 *   to another session, the pairing is gone).
 *
 * Photo sends (the composer emptied at their start, and their undo puts photos and words back),
 * recovery resends (their refusal marks the bubble "Not sent") and commands (no row, so no
 * outbox) keep what they always did.
 */
export type SendGateOutbox = {
  enter: () => void
  pass: () => void
  refuse: (message: string, unready?: MobileNativeChatSendUnready) => 'rejected' | 'unknown'
  /** A refusal after the gate and before any write (a dialog, a failed heal): words back, Retry. */
  giveBack: (message: string) => 'rejected' | 'unknown'
  /** The send went back to its caller unsaid (a reminted tab): the entry leaves the outbox. */
  drop: () => void
}

export function openSendGateOutbox(args: {
  origin: MobileNativeChatSendOrigin
  draftText: string
  /** A composer send of words to the conversation (not a command, an answer, or a pick). */
  chat: boolean
  syncComposer: boolean
  images?: string[]
  report: (message: string, details?: MobileNativeChatSendErrorDetails) => void
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  showSendingEcho?: (origin: MobileNativeChatSendOrigin) => void
}): SendGateOutbox {
  const { origin, draftText, report } = args
  // Only a text send typed in the composer, on its first try, takes the new path.
  const gated = args.syncComposer && args.chat && !args.images?.length && !origin.outboxRecovery
  // Handed to the outbox: the box empties and the bubble is drawn, as for a send on its way.
  const hold = (): boolean => {
    if (!gated || !releaseOutboxSendFromGate(origin.outboxId)) {
      return false
    }
    args.clearDraftForSend(origin, draftText)
    args.showSendingEcho?.(origin)
    return true
  }
  const giveBack = (message: string, retry = true): 'rejected' => {
    if (!gated) {
      report(message)
      return 'rejected'
    }
    void retireOutboxSend(origin.outboxId)
    if (retry) { report(message, { retry: true }) } else { report(message) }
    return 'rejected'
  }
  return {
    enter: () => {
      if (gated) {
        recordOutboxSend(origin, draftText, { atGate: true })
      }
    },
    pass: () => {
      if (gated) {
        passOutboxGate(origin.outboxId)
      } else if (args.syncComposer && args.chat) {
        // Before the box empties (native-chat-outbox-sends.ts); fail-open. A photo send's start
        // wrote its entry already, and this adopts it.
        recordOutboxSend(origin, draftText, { hasAttachments: Boolean(args.images?.length) })
      }
    },
    refuse: (message, unready) => {
      if (unready?.missing === 'connection' && hold()) {
        report(SEND_WAITS_FOR_DESKTOP)
        return 'unknown'
      }
      return giveBack(message, unready === undefined || unready.missing === 'connection' || unready.missing === 'input')
    },
    giveBack: (message) => {
      // No input box on the screen (a repaint that outlasted the looks, a shell, transcript mode):
      // the drainer types only once the box is back (observeTerminalOutboxEntry), so the message
      // waits in the outbox instead of failing, and the line says so.
      const waits = INPUT_BOX_REFUSALS.get(message)
      if (waits && hold()) {
        report(waits)
        return 'unknown'
      }
      return giveBack(message)
    },
    drop: () => {
      if (gated) {
        void retireOutboxSend(origin.outboxId)
      }
    }
  }
}
