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
 * kept tail and a new subscription clear it.
 *
 * A healthy reconnect replays the transcript on the same subscription, and
 * the window lacks what was written while the phone was away until that
 * snapshot lands, so from a new connection to its replay it is false (review
 * of c6d8394a: +94 on the 93-line create). Only the replay, or a window the
 * host replaces, ends that wait; a live row does not, as it may come first
 * (verification of c9480154: +125). The replay merged onto the same window,
 * untrimmed, leaves it starting where it did before the connection, or where
 * a page answered during the wait reached (fourth review of the line count:
 * read as the only way back, the subscription's 40-row tail shut the count
 * for the rest of the visit). A connection is taken from the client when a
 * frame lands, as well as from React's render of it, which may come after
 * the replay; a second connection before the replay keeps what the first
 * saved.
 */
export type WholeSessionTracker = {
  readonly whole: boolean
  subscribed(): void
  connected(lastConnectedAt: number | null | undefined): void
  frame(
    type: string | undefined,
    applied: { windowReplaced?: boolean; hasMore?: boolean; pending?: boolean; cursorInvalidated?: boolean },
    connectedAt?: number | null
  ): void
  retained(): void
  page(hasMore: boolean | undefined): void
}

export function createWholeSessionTracker(connectedAt: number | null): WholeSessionTracker {
  let whole = false
  let replayPending = false
  let wholeBeforeReplay = false
  let connection = connectedAt
  // Connection times only move forward; a client that cannot say yet (null)
  // or says an older one is not a new connection.
  const connected = (lastConnectedAt: number | null | undefined): void => {
    if (typeof lastConnectedAt !== 'number' || (connection !== null && lastConnectedAt <= connection)) {
      return
    }
    connection = lastConnectedAt
    if (!replayPending) {
      wholeBeforeReplay = whole
    }
    replayPending = true
    whole = false
  }
  return {
    get whole() {
      return whole
    },
    subscribed() {
      whole = false
      replayPending = false
      wholeBeforeReplay = false
    },
    connected,
    frame(type, applied, frameConnectedAt) {
      connected(frameConnectedAt)
      if (replayPending && (applied.windowReplaced || applied.cursorInvalidated)) {
        replayPending = false
        wholeBeforeReplay = false
      } else if (replayPending && type === 'snapshot') {
        replayPending = false
        whole = wholeBeforeReplay
        wholeBeforeReplay = false
      }
      if (type === 'snapshot' && !applied.windowReplaced && applied.hasMore === false && !applied.cursorInvalidated) {
        whole = true
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
      if (replayPending) {
        wholeBeforeReplay = hasMore === false
        return
      }
      whole = hasMore === false
    }
  }
}
