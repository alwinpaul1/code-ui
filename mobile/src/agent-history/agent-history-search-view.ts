import {
  searchIndexProgressLine,
  type SearchIndexState
} from './agent-history-search-index-state'
import type { SessionSearchResults, SessionSearchState } from './agent-history-search-state'

/**
 * What the search panel draws, and every sentence in it.
 *
 * `host` is the paired host's own display name ("this computer" when it has none). No sentence here
 * names a platform: the same Orca Settings path exists on macOS, Windows and Linux, so the copy is
 * the same for all three.
 *
 * `fallback` asks the panel to draw the sessions it has already loaded that match the query, under
 * the notice, whenever the index cannot answer. It is the list this box filtered before search
 * existed, so a host with search off still finds what it found yesterday.
 */

export type SearchNotice = {
  tone: 'info' | 'warning' | 'danger'
  /** The first line is the sentence that matters; any others are detail under it. */
  lines: string[]
  retry: boolean
}

export type SearchPanelView =
  | { kind: 'loading'; notice: SearchNotice | null; fallback: boolean }
  | { kind: 'results'; results: SessionSearchResults; notice: SearchNotice | null; count: string }
  | { kind: 'notice'; notice: SearchNotice; fallback: boolean }

export const SEARCH_FALLBACK_CAPTION = 'Loaded sessions that match'

/** What the copy says when the paired host has no name of its own. Never a platform word. */
export const UNNAMED_HOST_LABEL = 'this computer'

export function searchOffSentence(host: string): string {
  return `Session search is off on ${host}. Turn it on in Orca on that computer: Settings → Agent Session Search.`
}

export function searchScopeUnresolvedView(host: string): SearchPanelView {
  return notice(
    'warning',
    [
      `Session search cannot narrow to this workspace, because ${host} did not list it among its worktrees.`,
      'Switch the scope to All to search everything on it.'
    ],
    false
  )
}

export function searchPanelView(
  host: string,
  index: SearchIndexState,
  search: SessionSearchState
): SearchPanelView {
  switch (search.kind) {
    case 'waiting':
      return notice('info', [`Waiting for ${host}…`], false)
    case 'searching':
      return searchingView(host, index)
    case 'results':
      return resultsView(host, index, search)
    case 'unavailable':
      return unavailableView(host, index, search.reason)
    case 'index-changed':
      return notice(
        'warning',
        [`The index on ${host} changed while searching. Search again for current results.`],
        true
      )
    case 'unsupported':
      return unsupportedView(host)
    case 'failed':
      return notice('danger', [`Could not search ${host}: ${search.message}`], true)
    default: {
      const unhandled: never = search
      return unhandled
    }
  }
}

/**
 * A search in flight. Only an index known to answer (ready or building) gets the bare spinner the
 * desktop draws. Anything else keeps the loaded matches on screen, so the box never blanks on a
 * keystroke the index cannot answer. An index known to be off, or a host with no status method,
 * says so at once instead of spinning until the search is refused. The status method and the
 * search method joined the mobile allowlist in the same Orca commit (1f7655f3e3, #20277), so a host
 * without one has neither.
 */
function searchingView(host: string, index: SearchIndexState): SearchPanelView {
  switch (index.kind) {
    case 'off':
      return offView(host)
    case 'unsupported':
      return unsupportedView(host)
    case 'ready':
    case 'building':
      return { kind: 'loading', notice: buildingNotice(host, index, false), fallback: false }
    case 'checking':
    case 'paused':
    case 'unreadable':
      return { kind: 'loading', notice: null, fallback: true }
    default: {
      const unhandled: never = index
      return unhandled
    }
  }
}

function unsupportedView(host: string): SearchPanelView {
  return notice('warning', [`Session search needs a newer Orca on ${host}.`], false)
}

function resultsView(
  host: string,
  index: SearchIndexState,
  results: SessionSearchResults
): SearchPanelView {
  const count = `${String(results.hits.length)}${results.hasMore ? '+' : ''} ${
    results.hits.length === 1 && !results.hasMore ? 'result' : 'results'
  }`
  const lines: string[] = []
  if (results.hits.length === 0) {
    lines.push('No matching sessions in the indexed history. Try another query or scope.')
  }
  if (results.truncated) {
    lines.push(
      'Some results or matching text were limited. Narrow your search for more precise results.'
    )
  }
  const building = buildingNotice(host, index, true)
  if (building) {
    lines.push(...building.lines)
  }
  return {
    kind: 'results',
    results,
    count,
    notice: lines.length > 0 ? { tone: 'info', lines, retry: false } : null
  }
}

function unavailableView(host: string, index: SearchIndexState, reason: string): SearchPanelView {
  switch (reason) {
    case 'disabled':
      return offView(host)
    case 'not-ready': {
      if (index.kind === 'paused') {
        return pausedView(host, index.notes)
      }
      const progress = index.kind === 'building' || index.kind === 'ready' ? index : null
      return notice(
        'info',
        [
          `Session search is still building its index on ${host}.`,
          ...(progress ? [searchIndexProgressLine(progress.progress, 'building')] : []),
          'Results appear here when it is ready.',
          ...(progress ? progress.notes : [])
        ],
        false
      )
    }
    case 'no-service':
      return index.kind === 'paused'
        ? pausedView(host, index.notes)
        : notice(
            'warning',
            [
              `Session search is unavailable on ${host}. It may need an Orca update or a runtime with search support.`
            ],
            true
          )
    case 'scope-unknown':
      return notice(
        'warning',
        [
          `Session search on ${host} does not recognise this workspace or project. Switch the scope to All to search everything on it.`
        ],
        false
      )
    default:
      return notice('warning', [`Session search is unavailable on ${host} (${reason}).`], true)
  }
}

function offView(host: string): SearchPanelView {
  return notice('info', [searchOffSentence(host)], false)
}

function pausedView(host: string, notes: string[]): SearchPanelView {
  return notice('warning', [`Session search is not available on ${host} right now.`, ...notes], true)
}

/** The index is still reading files: say how far it has got, and that more may appear. */
function buildingNotice(
  host: string,
  index: SearchIndexState,
  withResults: boolean
): SearchNotice | null {
  if (index.kind === 'building') {
    return {
      tone: 'info',
      lines: [
        withResults
          ? `Session search is still building its index on ${host}, so more sessions may match.`
          : `Session search is still building its index on ${host}.`,
        searchIndexProgressLine(index.progress, 'building'),
        ...index.notes
      ],
      retry: false
    }
  }
  if (index.kind === 'ready' && index.notes.length > 0) {
    return { tone: 'info', lines: index.notes, retry: false }
  }
  return null
}

function notice(tone: SearchNotice['tone'], lines: string[], retry: boolean): SearchPanelView {
  return { kind: 'notice', notice: { tone, lines, retry }, fallback: true }
}
