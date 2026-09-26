import type { MobileNativeChatSession } from './use-mobile-native-chat-session'

/** Whether the chat holds its own settled read of the whole session, from its
 *  first row: what a check needs before it may say no call in the session
 *  touched something (the created-file count, MobileNativeChatOverlay.tsx).
 *  Not a tail kept over an empty re-subscribe (`baseRetained`), and only what
 *  the host said reaches the first row (`wholeSession`). */
export function holdsWholeSession(
  session: Pick<MobileNativeChatSession, 'status' | 'baseRetained' | 'wholeSession'>
): boolean {
  return session.status === 'ready' && session.baseRetained !== true && session.wholeSession === true
}

/**
 * Whether the chat session hook's window starts at the session's first row.
 * Only the host's own word sets it: `hasMore: false` on a fresh window, on a
 * replay merged from the window's oldest row, or on a page it answered. Never
 * inferred from a row count (a host that omits `hasMore`, the 12-row retry),
 * and never at the 2000-row paging cap (review of c914027d). A live trim, a
 * kept tail and a new subscription clear it. A healthy reconnect replays the
 * transcript on the same subscription, so until that snapshot lands a page
 * cannot set it (review of c6d8394a: +94 on the 93-line create).
 */
export type WholeSessionTracker = {
  readonly whole: boolean
  subscribed(): void
  connected(lastConnectedAt: number | null): void
  frame(type: string | undefined, applied: { windowReplaced?: boolean; hasMore?: boolean; pending?: boolean; cursorInvalidated?: boolean }): void
  retained(): void
  page(hasMore: boolean | undefined): void
}

export function createWholeSessionTracker(connectedAt: number | null): WholeSessionTracker {
  let whole = false
  let replayPending = false
  let connection = connectedAt
  return {
    get whole() {
      return whole
    },
    subscribed() {
      whole = false
    },
    connected(lastConnectedAt) {
      if (lastConnectedAt !== connection) {
        connection = lastConnectedAt
        replayPending = true
        whole = false
      }
    },
    frame(type, applied) {
      if (type === 'snapshot') {
        replayPending = false
        if (!applied.windowReplaced && applied.hasMore === false && !applied.cursorInvalidated) {
          whole = true
        }
      }
      if (applied.windowReplaced) {
        whole = applied.hasMore === false && !applied.pending
      }
      if (applied.cursorInvalidated) {
        whole = false
      }
    },
    retained() {
      whole = false
    },
    page(hasMore) {
      whole = hasMore === false && !replayPending
    }
  }
}
