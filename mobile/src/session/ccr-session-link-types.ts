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
 *  the last, the stream is `lost`: it tries again on CCR_STREAM_LOST_RETRY_MS, and at once on `retry()`
 *  (a relay reconnect) or `resume()` (the app back in front). */
export const CCR_STREAM_RECONNECT_MS: readonly number[] = [1_000, 3_000, 7_000, 15_000, 31_000]
/** Once `lost`, the stream tries again once after each of these waits (1, 5 and 15 min), one
 *  stream request per wait, and then stays lost until `retry()` or `resume()`. A matched Claude
 *  chat's rows come from this stream, so a lost one with the relay healthy froze them for good;
 *  the cap keeps a down Anthropic from being redialled in a loop (review 2026-10-15). Not the
 *  Claude app's behaviour: its stream has a backplane of its own. */
export const CCR_STREAM_LOST_RETRY_MS: readonly number[] = [60_000, 300_000, 900_000]
/** A connection starts the back-off over when it delivered an event the link did not hold AND
 *  stayed up this long (or stayed up CCR_STREAM_IDLE_STABLE_MS with none): a server that answers
 *  and closes at once, whatever it sends first, is backed off to `lost` rather than redialled every
 *  second (review 2026-10-15). */
export const CCR_STREAM_STABLE_MS = 5_000
/** A connection that stayed up this long starts the back-off over even with no new event: a
 *  healthy stream on an idle session, dropped by the network now and then, is not counted toward
 *  `lost` (review 2026-10-15: five such drops over hours lost the link). */
export const CCR_STREAM_IDLE_STABLE_MS = 30_000
/** A burst of streamed events is kept on the phone once, this long after its first event: each
 *  write trims and sizes the whole kept copy (review 2026-10-15). */
export const CCR_PERSIST_STREAM_MS = 750
/** The Claude app's page sizes (xjw.java:92-117, ujw `g()`): the newest page 200 events, older
 *  pages 500. With 84% of events `system` (observed live 2026-10-14), a page of 100 can hold no
 *  row at all. */
export const CCR_FIRST_PAGE_EVENTS = 200
export const CCR_OLDER_PAGE_EVENTS = 500
/** Newest pages read on an open that already holds rows, before the stream (`xjw.b`
 *  "loadLatestPageV2" in the app reads up to 2 of CCR_FIRST_PAGE_EVENTS; ccr-session-link.ts
 *  `catchUp`). */
export const CCR_CATCH_UP_PAGES = 2

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
  /** The sequence number up to which the held events were read from the phone's kept copy, not
   *  from Anthropic (0 when none were). The kept copy keeps rows only, no `result`, so the live
   *  state (ccr-live-state.ts) judges the turn only from events after it. */
  liveFrom: number
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
