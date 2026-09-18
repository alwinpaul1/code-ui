import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ConfirmModal } from '../components/ConfirmModal'
import { nativeChatMessageText } from './mobile-native-chat-message-text'
import { countMessagesDroppedByRewind, rewindConfirmCopy } from './mobile-structured-agent-rewind'

/**
 * "Rewind to here" for the chat list: which rows may offer it, the confirm
 * sheet, and what happens after the host accepts.
 *
 * Offered only where the lane hands in a way to rewind (the structured lane,
 * on a host that said it will), and only on JOURNALLED user messages — a
 * pending echo has no item id the host could rewind to. The sheet names how
 * many bubbles go, or says "later messages" when the tapped row is not in the
 * drawn list, and says in plain words that files stay as they are.
 *
 * After an accepted rewind the dropped prompt goes back into the composer, the
 * way Claude Code's own `/rewind` restores it, but only into an EMPTY composer:
 * a draft the reader is typing is theirs.
 */
export function useMobileNativeChatRewind(args: {
  /** The raw transcript: every id here is a journal item the host can name. */
  messages: readonly NativeChatMessage[]
  /** What is drawn, for counting the bubbles a rewind drops. */
  folded: readonly NativeChatMessage[]
  /** Undefined on a lane that cannot rewind; resolves true only when the host accepted. */
  onRewindToMessage?: (messageId: string) => Promise<boolean>
  composerText: string
  onComposerTextChange: (text: string) => void
}): {
  rewindable: ReadonlySet<string>
  request: ((messageId: string) => void) | undefined
  sheet: ReactNode
} {
  const { messages, folded, onRewindToMessage, composerText, onComposerTextChange } = args
  const [pending, setPending] = useState<string | null>(null)
  const inFlight = useRef(false)
  // Read at confirm time, not captured when the sheet opened: the reader may
  // type while it is up, and that draft must not be overwritten.
  const composerRef = useRef({ composerText, onComposerTextChange })
  composerRef.current = { composerText, onComposerTextChange }

  const rewindable = useMemo(
    () =>
      new Set(
        onRewindToMessage
          ? messages.filter((message) => message.role === 'user').map((message) => message.id)
          : []
      ),
    [messages, onRewindToMessage]
  )

  const request = useCallback((messageId: string) => {
    if (!inFlight.current) {
      setPending(messageId)
    }
  }, [])

  const confirm = useCallback(
    (messageId: string) => {
      if (!onRewindToMessage || inFlight.current) {
        return
      }
      const dropped = messages.find((message) => message.id === messageId)
      const prompt = dropped ? nativeChatMessageText(dropped.blocks) : ''
      inFlight.current = true
      void onRewindToMessage(messageId)
        .then((accepted) => {
          const composer = composerRef.current
          if (accepted && prompt && composer.composerText.trim() === '') {
            composer.onComposerTextChange(prompt)
          }
        })
        .finally(() => {
          inFlight.current = false
        })
    },
    [messages, onRewindToMessage]
  )

  const copy = rewindConfirmCopy(
    pending === null ? null : countMessagesDroppedByRewind(folded, pending)
  )
  const sheet = onRewindToMessage ? (
    <ConfirmModal
      visible={pending !== null}
      title={copy.title}
      message={copy.message}
      confirmLabel="Rewind"
      destructive
      onConfirm={() => {
        if (pending !== null) {
          confirm(pending)
        }
      }}
      onCancel={() => setPending(null)}
    />
  ) : null

  return { rewindable, request: onRewindToMessage ? request : undefined, sheet }
}
