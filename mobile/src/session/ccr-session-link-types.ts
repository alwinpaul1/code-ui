import type { CcrEvent, CcrFetch } from './ccr-session-api'
import type { CcrStreamFetch } from './ccr-event-stream'
import type { CcrImageKeeper } from './ccr-transcript-decode'

/** What a session link (ccr-session-link.ts) is given and what it says, apart from its logic. */

export type CcrLinkAuth = { token: string; organizationUuid: string }

export type CcrLinkDeps = {
  fetch: CcrFetch
  streamFetch: CcrStreamFetch
  /** This account's live token and organization, or null once it is signed out. `fresh`: read
   *  the sign-in again rather than a copy held from before (after a 401). */
  auth: (accountId: string, fresh: boolean) => Promise<CcrLinkAuth | null>
  keep: CcrImageKeeper
  log?: (line: string) => void
  /** For tests: the timer the reconnect back-off waits on. */
  setTimer?: (run: () => void, ms: number) => () => void
  /** For tests: the clock a connection's time up is measured on (Date.now). */
  now?: () => number
}

/** The waits before each reconnect, as the Claude app's stream does (1, 3, 7, 15, 31 s). After
 *  the last, the stream is `lost` until `retry()` (a relay reconnect, the app back in front). */
export const CCR_STREAM_RECONNECT_MS: readonly number[] = [1_000, 3_000, 7_000, 15_000, 31_000]
/** A connection starts the back-off over only when it delivered an event the link did not hold
 *  AND stayed up this long: a server that answers and closes at once, whatever it sends first, is
 *  backed off to `lost` rather than redialled every second (review 2026-10-15). */
export const CCR_STREAM_STABLE_MS = 5_000
/** The Claude app's page sizes (xjw.java:92-117, ujw `g()`): the newest page 200 events, older
 *  pages 500. With 84% of events `system` (observed live 2026-10-14), a page of 100 can hold no
 *  row at all. */
export const CCR_FIRST_PAGE_EVENTS = 200
export const CCR_OLDER_PAGE_EVENTS = 500

export type CcrLinkPhase = 'idle' | 'loading' | 'live' | 'reconnecting' | 'lost' | 'error'

export type CcrLinkState = {
  /** Oldest first, by sequence number. */
  events: readonly CcrEvent[]
  phase: CcrLinkPhase
  /** What failed, in words for the screen, when `phase` is `lost` or `error`. */
  error: string | null
  /** Whether older events may exist (scroll to the start loads them). */
  hasOlder: boolean
  loadingOlder: boolean
  /** The Remote Control session's `connection_status`, from the stream's `session_update`. */
  connectionStatus: string | null
  /** Bumped on every change, for useSyncExternalStore. */
  version: number
}

export function ccrEventKey(event: CcrEvent): string | null {
  const uuid = event.payload.uuid
  if (typeof uuid === 'string' && uuid) {
    return `u:${uuid}`
  }
  if (event.eventId) {
    return `e:${event.eventId}`
  }
  return event.sequenceNum == null ? null : `s:${event.sequenceNum}`
}

export function bySequence(a: CcrEvent, b: CcrEvent): number {
  return (a.sequenceNum ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNum ?? Number.MAX_SAFE_INTEGER)
}

export const defaultCcrTimer = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}
