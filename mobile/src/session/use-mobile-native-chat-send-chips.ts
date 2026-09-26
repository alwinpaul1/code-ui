import { useCallback, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { draftWasSent } from './mobile-native-chat-draft-reconcile'
import {
  nativeChatAttachmentsResets,
  nativeChatWaitingSends,
  useNativeChatImageAttachmentsStore
} from './mobile-native-chat-image-attachments-store'
import { NO_NATIVE_CHAT_IMAGE_ATTACHMENTS } from './mobile-native-chat-image-scope-state'
import {
  MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS,
  type MobileNativeChatSendGate
} from './mobile-native-chat-send-readiness'

type CurrentRef<T> = { readonly current: T }

/** Why a send tapped beside a chip still uploading wrote nothing, and the chip it waited on. */
export type MobileNativeChatSendChipsRefusal = {
  readonly reason: 'failed' | 'markup' | 'timeout' | 'session' | 'busy'
  readonly chip: PendingNativeChatImage | null
}

// The store says when a chip settles. The beat is for the deadline and for a
// tab switch, which arrive through refs, not through the store.
const MOBILE_NATIVE_CHAT_SEND_CHIPS_POLL_MS = 100

function chipsIn(scope: string): readonly PendingNativeChatImage[] {
  return (
    useNativeChatImageAttachmentsStore.getState().byScope[scope] ?? NO_NATIVE_CHAT_IMAGE_ATTACHMENTS
  )
}

function nextChipChange(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useNativeChatImageAttachmentsStore.subscribe(() => finish())
    const timer = setTimeout(() => finish(), ms)
    function finish(): void {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
  })
}

/**
 * The chips a send was tapped with, as they stand once every upload among them
 * has finished, waited for on the send's own budget.
 *
 * Why: a send used to take only the chips whose upload had finished, and one
 * still uploading stayed behind for the next send without a word. Send was
 * greyed during a first upload, but the markup editor's re-upload never marked
 * its chip, so a marked-up screenshot sent just after Done went to the desktop
 * without its marks, and the marked copy went with the next message
 * (2026-09-26). Nothing has been written when this runs, so a send that waits
 * here and then refuses leaves the text and the chips as they were.
 */
export async function settleMobileNativeChatSendChips(args: {
  readonly scope: string
  /** The chips in the strip at the tap. One picked during the wait stays for the next send. */
  readonly ids: readonly string[]
  readonly deadline: number
  /** True once the send's tab or terminal has gone, or the store was reset. */
  readonly abandoned: () => boolean
}): Promise<PendingNativeChatImage[] | MobileNativeChatSendChipsRefusal> {
  // Each chip as it was drawn while it uploaded. A first upload that fails
  // takes its chip away; a markup upload that fails puts the photo's own
  // picture back. Either way the bytes the send waited for never arrived.
  const uploading = new Map<string, PendingNativeChatImage>()
  for (;;) {
    // First, before a settled chip can be returned: a tab switch writes no
    // chip, so the wake after one can be the upload landing, and that sent
    // one tab's photo into the next tab's terminal (2026-09-26 review).
    if (args.abandoned()) {
      return { reason: 'session', chip: null }
    }
    const byId = new Map(chipsIn(args.scope).map((chip) => [chip.id, chip]))
    let waiting: PendingNativeChatImage | null = null
    for (const id of args.ids) {
      const chip = byId.get(id)
      const drawn = uploading.get(id)
      if (chip?.uploading) {
        uploading.set(id, chip)
        waiting ??= chip
      } else if (drawn && !chip) {
        return { reason: 'failed', chip: drawn }
      } else if (drawn && chip && chip.previewUri !== drawn.previewUri) {
        return { reason: 'markup', chip }
      }
    }
    if (!waiting) {
      // A chip the user took out during the wait is not sent.
      return args.ids.flatMap((id) => byId.get(id) ?? [])
    }
    // The same reserve the link's wait keeps, so the paste and the text still fit.
    const remainingMs = args.deadline - MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS - Date.now()
    if (remainingMs <= 0) {
      return { reason: 'timeout', chip: waiting }
    }
    await nextChipChange(Math.min(MOBILE_NATIVE_CHAT_SEND_CHIPS_POLL_MS, remainingMs))
  }
}

function chipNoun(chip: PendingNativeChatImage | null): string {
  return chip?.kind === 'file' ? (chip.name ?? 'a file') : 'a photo'
}

/** The one line a send that waited on an upload and wrote nothing leaves behind. */
export function mobileNativeChatSendChipsRefusalMessage({
  reason,
  chip
}: MobileNativeChatSendChipsRefusal): string {
  switch (reason) {
    case 'failed':
      // The attach toast has already said why (too large, disconnected).
      return `Message not sent: ${chipNoun(chip)} did not upload`
    case 'markup':
      return 'Message not sent: the markup was not saved. Send again to send the photo without it'
    case 'timeout':
      return `Message not sent: ${chipNoun(chip)} was still uploading`
    case 'session':
      return 'Message not sent (session changed)'
    case 'busy':
      // A different message, or one with a photo added, tapped while one
      // waits: it cannot go first, and going after would send the same
      // photos twice (2026-09-26 reviews).
      return `Message not sent: the last message is still waiting for ${chipNoun(chip)}`
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}

/** What a send tapped beside the chips knows at the tap. */
export type MobileNativeChatSendChipsTap = {
  readonly scope: string | null
  readonly deadline: number
  readonly terminal: string | null
  readonly text: string
}

/** Runs `send` with a send's chips: at once when none is uploading, so that
 *  send runs exactly as it did before any wait existed, or else once they
 *  have settled, checked against the tab (and, on a terminal lane, the
 *  terminal) of the latest render, so a wait that outlives a tab switch gives
 *  up instead of sending one tab's photo into another. A refusal goes to
 *  `onSendError` and resolves false.
 *
 *  A chat that remounts during the wait draws Send live again beside the
 *  same text and chips, and a tap there sent the message twice on a session
 *  tab, which has no terminal to lock. So a tap with the same text (trimmed,
 *  as the draft store compares it) and no chip the first tap lacked, on a tab
 *  whose send is waiting, is that send, and resolves as it does; any other
 *  tap is refused. Only the wait is joined: once the chips have settled, a
 *  tap is a new send again, refused by the terminal's lock or sent on a
 *  session tab as it always was (2026-09-26 reviews). */
export function useMobileNativeChatSendChips(args: {
  readonly scopeKey: string | null
  readonly activeHandleRef: CurrentRef<string | null>
  /** A session lane's send goes to the session, whatever the tab's terminal. */
  readonly structuredNativeChat: boolean
  readonly client: Pick<RpcClient, 'getState'> | null
  /** The lane's gate, which names the link when the link is what held the upload up. */
  readonly sendGate: Pick<MobileNativeChatSendGate, 'now'>
  readonly onError?: () => void
  readonly onSendError: (message: string) => void
}): (
  tap: MobileNativeChatSendChipsTap,
  send: (chips: PendingNativeChatImage[]) => Promise<boolean>
) => Promise<boolean> {
  const latest = useRef(args)
  latest.current = args
  return useCallback(({ scope, deadline, terminal, text }, send) => {
    const chips = scope ? chipsIn(scope) : NO_NATIVE_CHAT_IMAGE_ATTACHMENTS
    const refuse = (settled: MobileNativeChatSendChipsRefusal): boolean => {
      const { client, sendGate } = latest.current
      // A link that drops holds the upload with it, and "was still uploading"
      // named the photo, not the cause (2026-09-26 review). The gate's own
      // refusal says what the link is doing, and goes out by itself.
      if (
        settled.reason === 'timeout' &&
        client?.getState() !== 'connected' &&
        sendGate.now() === null
      ) {
        return false
      }
      latest.current.onError?.()
      latest.current.onSendError(mobileNativeChatSendChipsRefusalMessage(settled))
      return false
    }
    const waiting = scope ? nativeChatWaitingSends.get(scope) : undefined
    if (waiting) {
      // The text trimmed as the draft store compares it, which empties the
      // box once the first send lands: a trailing space was "not sent" over a
      // message that went. And no chip the first tap did not have: a photo
      // picked since stayed in the strip while the tap read as sent
      // (2026-09-26 reviews). A tap with a chip taken out since still joins:
      // the wait sees that chip gone.
      const same =
        draftWasSent(waiting.text, text) && chips.every((chip) => waiting.ids.includes(chip.id))
      return same
        ? waiting.whole
        : Promise.resolve(
            refuse({ reason: 'busy', chip: chips.find((chip) => chip.uploading) ?? null })
          )
    }
    if (!scope || !chips.some((chip) => chip.uploading)) {
      return send([...chips])
    }
    const resets = nativeChatAttachmentsResets.current
    const ids = chips.map((chip) => chip.id)
    const waited = settleMobileNativeChatSendChips({
      scope,
      ids,
      deadline,
      abandoned: () =>
        nativeChatAttachmentsResets.current !== resets ||
        latest.current.scopeKey !== scope ||
        (!latest.current.structuredNativeChat &&
          latest.current.activeHandleRef.current !== terminal)
    })
    const entry = {
      text,
      ids,
      whole: waited.then((settled) => (Array.isArray(settled) ? send(settled) : refuse(settled)))
    }
    nativeChatWaitingSends.set(scope, entry)
    // Runs after `send` has started, in the same turn, so no tap falls between
    // the wait ending and the send taking the terminal.
    const release = (): void => {
      if (nativeChatWaitingSends.get(scope) === entry) {
        nativeChatWaitingSends.delete(scope)
      }
    }
    void waited.then(release, release)
    return entry.whole
  }, [])
}
