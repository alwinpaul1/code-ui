import type {
  AgentSessionSearchHit,
  AgentSessionSearchResponse
} from './agent-history-search-reply-schema'
import type { SearchIndexKind } from './agent-history-search-index-state'

/**
 * Where one session search stands, and the pure steps between its states.
 *
 * The hook in use-agent-session-search.ts owns the timers and the wire; this module owns what a
 * reply means, so each reading is a plain function a test can hand a reply to.
 */

export type SessionSearchResults = {
  kind: 'results'
  hits: AgentSessionSearchHit[]
  cursor: string | null
  hasMore: boolean
  /** The host capped candidates, the query, or snippets, so a narrower query finds more. */
  truncated: boolean
  /** How many pages are on screen. A re-run for a finished index only replaces page one. */
  pages: number
  loadingMore: boolean
  loadMoreError: string | null
}

export type SessionSearchState =
  | { kind: 'waiting' }
  | { kind: 'searching' }
  | SessionSearchResults
  | { kind: 'unavailable'; reason: string }
  | { kind: 'index-changed' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }

/** One session is one row, whichever page it arrived on. */
export function searchHitKey(hit: Pick<AgentSessionSearchHit, 'agent' | 'sessionId'>): string {
  return `${hit.agent}:${hit.sessionId}`
}

/**
 * A first page's reply. Neither cursor verdict can answer a request that carried no cursor, so
 * either one here means the index moved underneath the query, which the desktop words as "the
 * index changed while searching".
 */
export function firstPageSearchState(response: AgentSessionSearchResponse): SessionSearchState {
  switch (response.kind) {
    case 'results':
      return {
        kind: 'results',
        hits: uniqueHits([], response.hits),
        cursor: response.page.cursor,
        hasMore: response.page.hasMore && response.page.cursor !== null,
        truncated: isTruncated(response.truncated),
        pages: 1,
        loadingMore: false,
        loadMoreError: null
      }
    case 'unavailable':
      return { kind: 'unavailable', reason: response.reason }
    case 'stale-cursor':
    case 'malformed-cursor':
      return { kind: 'index-changed' }
    default: {
      const unhandled: never = response
      return unhandled
    }
  }
}

/**
 * A later page's reply, appended to what is on screen.
 *
 * `restart` is the stale-cursor case: the index moved on since page one, so the desktop re-runs
 * page one and replaces the list rather than splicing two generations together. The caller does
 * that, because it owns the wire.
 */
export function nextPageSearchState(
  previous: SessionSearchResults,
  response: AgentSessionSearchResponse
): SessionSearchState | 'restart' {
  switch (response.kind) {
    case 'results':
      return {
        ...previous,
        hits: uniqueHits(previous.hits, response.hits),
        cursor: response.page.cursor,
        hasMore: response.page.hasMore && response.page.cursor !== null,
        truncated: previous.truncated || isTruncated(response.truncated),
        pages: previous.pages + 1,
        loadingMore: false,
        loadMoreError: null
      }
    case 'stale-cursor':
      return 'restart'
    case 'malformed-cursor':
      return { kind: 'index-changed' }
    case 'unavailable':
      return { kind: 'unavailable', reason: response.reason }
    default: {
      const unhandled: never = response
      return unhandled
    }
  }
}

/**
 * Whether a change in the index should run the search again by itself.
 *
 * This is how "turn it on at the desktop" reaches the screen with no tap: the status poll sees
 * off become building or ready, and a search that was refused re-asks. A refusal that already
 * agrees with the new reading (disabled while off, not-ready while building) is left alone, and
 * so is a list the user has paged into, which only pull-to-refresh replaces. The first reading
 * after `checking` re-runs only a refusal, because the search and the status went out together
 * and the status may simply have answered second.
 */
export function shouldRerunSearchForIndex(
  previous: SearchIndexKind,
  next: SearchIndexKind,
  state: SessionSearchState
): boolean {
  if (previous === next || !isSettledIndexKind(next)) {
    return false
  }
  if (state.kind === 'unavailable') {
    return !refusalMatchesIndex(state.reason, next)
  }
  if (previous === 'checking' || !isSettledIndexKind(previous)) {
    return false
  }
  if (state.kind === 'results') {
    return previous === 'building' && next === 'ready' && state.pages === 1
  }
  return false
}

function isSettledIndexKind(kind: SearchIndexKind): boolean {
  switch (kind) {
    case 'off':
    case 'building':
    case 'paused':
    case 'ready':
      return true
    case 'checking':
    case 'unsupported':
    case 'unreadable':
      return false
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

function refusalMatchesIndex(reason: string, kind: SearchIndexKind): boolean {
  return (reason === 'disabled' && kind === 'off') || (reason === 'not-ready' && kind === 'building')
}

function uniqueHits(
  onScreen: readonly AgentSessionSearchHit[],
  incoming: readonly AgentSessionSearchHit[]
): AgentSessionSearchHit[] {
  const seen = new Set(onScreen.map(searchHitKey))
  const merged = [...onScreen]
  for (const hit of incoming) {
    const key = searchHitKey(hit)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(hit)
    }
  }
  return merged
}

// The desktop's rule (AiVaultPanelSearch): freshness alone is not worth a notice.
function isTruncated(truncated: {
  candidates: boolean
  snippets: number
  query: boolean
}): boolean {
  return truncated.candidates || truncated.query || truncated.snippets > 0
}
