import { useSyncExternalStore } from 'react'

/**
 * Whether the send failure the chat's banner holds offers Retry (S5 of
 * docs/claude-app-parity-gaps.md): a send whose words are back in the composer, refused before
 * anything was written or with its body write refused by the desktop, as the Claude app's snackbar
 * does.
 *
 * Held beside the banner's message rather than threaded through the route, overlay and view with
 * it: only one banner is up at a time (the send-error hook scopes it to the tab on screen), and
 * the banner shows Retry only while the message it draws is the one held here, so a later
 * failure without a Retry never inherits one.
 */
let held: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** The banner now shows `message`; `retry` says whether it offers Retry. */
export function holdSendErrorRetry(message: string, retry: boolean): void {
  const next = retry ? message : null
  if (next !== held) {
    held = next
    notify()
  }
}

/** The banner's message went away. */
export function dropSendErrorRetry(): void {
  if (held !== null) {
    held = null
    notify()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The banner message that offers Retry now, if any. */
export const sendErrorRetryMessage = (): string | null => held
const read = sendErrorRetryMessage

/** Whether the banner drawing `message` offers Retry. */
export function useSendErrorRetryable(message: string | null | undefined): boolean {
  const current = useSyncExternalStore(subscribe, read, read)
  return typeof message === 'string' && message !== '' && current === message
}

/** What the banner's Retry does: the composer's words go again, by the same path as its Send
 *  button, and the banner goes. Nothing when the box is empty and holds no attachment (the user
 *  took them); a failed send of attachments with no words goes again with its chips. */
export function retrySendFromComposer(
  composerText: string,
  send: (text: string) => Promise<boolean>,
  clearBanner?: () => void,
  attachments = 0
): void {
  if (composerText.trim() === '' && attachments === 0) {
    return
  }
  clearBanner?.()
  dropSendErrorRetry()
  void send(composerText)
}

/** Test-only: module state outlives a single test. */
export function resetSendErrorRetryForTests(): void {
  held = null
  listeners.clear()
}
