import { describe, expect, it } from 'vitest'
import { searchHit } from './agent-session-search.test-support'
import type { SearchIndexState } from './agent-history-search-index-state'
import type { SessionSearchResults, SessionSearchState } from './agent-history-search-state'
import {
  searchOffSentence,
  searchPanelView,
  searchScopeUnresolvedView,
  UNNAMED_HOST_LABEL,
  type SearchPanelView
} from './agent-history-search-view'

/**
 * Every sentence the search panel can say, from the index reading and the search state. The panel
 * suites prove these reach the screen; these prove each one says the right thing about the host.
 */

const READY: SearchIndexState = {
  kind: 'ready',
  progress: { sessionsIndexed: 40, sessionsTotal: 40, messagesIndexed: 3400 },
  notes: []
}
const BUILDING: SearchIndexState = {
  kind: 'building',
  progress: { sessionsIndexed: 12, sessionsTotal: 40, messagesIndexed: 3400 },
  notes: []
}

function results(overrides: Partial<SessionSearchResults> = {}): SessionSearchResults {
  return {
    kind: 'results',
    hits: [searchHit()],
    cursor: null,
    hasMore: false,
    truncated: false,
    pages: 1,
    loadingMore: false,
    loadMoreError: null,
    ...overrides
  }
}

function lines(view: SearchPanelView): string[] {
  switch (view.kind) {
    case 'loading':
    case 'results':
      return view.notice?.lines ?? []
    case 'notice':
      return view.notice.lines
    default: {
      const unhandled: never = view
      return unhandled
    }
  }
}

function viewFor(search: SessionSearchState, index: SearchIndexState = READY, host = 'Studio') {
  return searchPanelView(host, index, search)
}

const PLATFORM_WORDS = /\b(Mac|macOS|Windows|PC|Linux|laptop|desktop)\b/i

describe('saying search is off', () => {
  it('names the host and the exact desktop path, word for word', () => {
    expect(searchOffSentence('Studio')).toBe(
      'Session search is off on Studio. Turn it on in Orca on that computer: Settings → Agent Session Search.'
    )
  })

  it('says it for a search the host refused as disabled', () => {
    expect(lines(viewFor({ kind: 'unavailable', reason: 'disabled' }, { kind: 'off' }))).toEqual([
      searchOffSentence('Studio')
    ])
  })

  it('says it at once while a search is in flight to an index already known to be off', () => {
    expect(viewFor({ kind: 'searching' }, { kind: 'off' })).toMatchObject({
      kind: 'notice',
      notice: { lines: [searchOffSentence('Studio')] }
    })
  })

  it('names a Windows host by its own name and no platform word', () => {
    const sentence = lines(viewFor({ kind: 'unavailable', reason: 'disabled' }, { kind: 'off' }, 'DESKTOP-7Q2'))[0]
    expect(sentence).toBe(
      'Session search is off on DESKTOP-7Q2. Turn it on in Orca on that computer: Settings → Agent Session Search.'
    )
    expect(sentence?.replace('DESKTOP-7Q2', '')).not.toMatch(PLATFORM_WORDS)
  })

  it('says "this computer" for a host with no name of its own', () => {
    expect(searchOffSentence(UNNAMED_HOST_LABEL)).toBe(
      'Session search is off on this computer. Turn it on in Orca on that computer: Settings → Agent Session Search.'
    )
  })

  it('keeps the loaded list under the notice, so a search still finds what it found before', () => {
    expect(viewFor({ kind: 'unavailable', reason: 'disabled' }, { kind: 'off' })).toMatchObject({
      kind: 'notice',
      fallback: true
    })
  })
})

describe('saying the index is still building', () => {
  it('shows how far the first pass has got, in sessions and messages', () => {
    expect(lines(viewFor({ kind: 'unavailable', reason: 'not-ready' }, BUILDING))).toEqual([
      'Session search is still building its index on Studio.',
      '12 of 40 sessions · 3400 messages searchable',
      'Results appear here when it is ready.'
    ])
  })

  it('says it is building without numbers it does not have yet', () => {
    expect(lines(viewFor({ kind: 'unavailable', reason: 'not-ready' }, { kind: 'checking' }))).toEqual([
      'Session search is still building its index on Studio.',
      'Results appear here when it is ready.'
    ])
  })

  it('warns that more may match over results that arrived mid-pass', () => {
    expect(lines(viewFor(results(), BUILDING))).toEqual([
      'Session search is still building its index on Studio, so more sessions may match.',
      '12 of 40 sessions · 3400 messages searchable'
    ])
  })

  it('shows progress under the spinner while the search is in flight', () => {
    expect(viewFor({ kind: 'searching' }, BUILDING)).toMatchObject({
      kind: 'loading',
      notice: { lines: expect.arrayContaining(['12 of 40 sessions · 3400 messages searchable']) }
    })
  })

  it("adds the host's own reasons for what it could not read", () => {
    const index: SearchIndexState = { ...BUILDING, notes: ['OpenCode-in-WSL is not searchable from Windows yet'] }
    expect(lines(viewFor({ kind: 'unavailable', reason: 'not-ready' }, index))).toContain(
      'OpenCode-in-WSL is not searchable from Windows yet'
    )
  })

  it('shows a ready index\'s notes over its results, and nothing when it has none', () => {
    expect(lines(viewFor(results(), { ...READY, notes: ['2 session folders could not be checked.'] }))).toEqual([
      '2 session folders could not be checked.'
    ])
    expect(viewFor(results(), READY)).toMatchObject({ kind: 'results', notice: null })
  })
})

describe('what a search in flight draws, by what the index is known to be', () => {
  const inFlight: [string, SearchPanelView['kind'], boolean, SearchIndexState][] = [
    ['a ready index', 'loading', false, READY],
    ['a building index', 'loading', false, BUILDING],
    ['an index not yet read', 'loading', true, { kind: 'checking' }],
    ['a paused index', 'loading', true, { kind: 'paused', notes: [] }],
    ['an unreadable index', 'loading', true, { kind: 'unreadable', message: 'status unavailable' }],
    ['an index that is off', 'notice', true, { kind: 'off' }],
    ['a host with no index at all', 'notice', true, { kind: 'unsupported' }]
  ]
  it.each(inFlight)(
    'draws %s as %s, with the loaded matches under it: %s',
    (_label, kind, fallback, index) => {
      expect(viewFor({ kind: 'searching' }, index)).toMatchObject({ kind, fallback })
    }
  )

  it('says a newer Orca is needed at once, rather than spinning, when the host has no status method', () => {
    expect(lines(viewFor({ kind: 'searching' }, { kind: 'unsupported' }))).toEqual([
      'Session search needs a newer Orca on Studio.'
    ])
  })
})

describe('counting results', () => {
  it('says no results and why when the page is empty', () => {
    const view = viewFor(results({ hits: [] }))
    expect(view).toMatchObject({ kind: 'results', count: '0 results' })
    expect(lines(view)).toEqual([
      'No matching sessions in the indexed history. Try another query or scope.'
    ])
  })

  it('says one result in the singular', () => {
    expect(viewFor(results())).toMatchObject({ count: '1 result' })
  })

  it('marks a count with more pages behind it as a lower bound', () => {
    const hits = Array.from({ length: 20 }, (_, index) => searchHit({ sessionId: `s-${index}` }))
    expect(viewFor(results({ hits, hasMore: true, cursor: 'c-2' }))).toMatchObject({ count: '20+ results' })
    expect(viewFor(results({ hasMore: true, cursor: 'c-2' }))).toMatchObject({ count: '1+ results' })
  })

  it('says a truncated search was limited', () => {
    expect(lines(viewFor(results({ truncated: true })))).toEqual([
      'Some results or matching text were limited. Narrow your search for more precise results.'
    ])
  })
})

describe('saying why a search has no answer', () => {
  it('waits for the host by name while the connection is down', () => {
    expect(lines(viewFor({ kind: 'waiting' }))).toEqual(['Waiting for Studio…'])
  })

  it("puts the host's own message in a failed search, with a retry", () => {
    expect(viewFor({ kind: 'failed', message: 'index exploded' })).toMatchObject({
      kind: 'notice',
      notice: { tone: 'danger', lines: ['Could not search Studio: index exploded'], retry: true }
    })
  })

  it('asks for a newer Orca when the host has no search method', () => {
    expect(lines(viewFor({ kind: 'unsupported' }))).toEqual([
      'Session search needs a newer Orca on Studio.'
    ])
  })

  it('says the service is missing, and offers a retry', () => {
    expect(viewFor({ kind: 'unavailable', reason: 'no-service' })).toMatchObject({
      notice: {
        lines: [
          'Session search is unavailable on Studio. It may need an Orca update or a runtime with search support.'
        ],
        retry: true
      }
    })
  })

  it("says an idle index is not available right now, the desktop's words", () => {
    expect(
      lines(viewFor({ kind: 'unavailable', reason: 'no-service' }, { kind: 'paused', notes: [] }))
    ).toEqual(['Session search is not available on Studio right now.'])
  })

  it('points a scope the host does not recognise at All', () => {
    expect(lines(viewFor({ kind: 'unavailable', reason: 'scope-unknown' }))).toEqual([
      'Session search on Studio does not recognise this workspace or project. Switch the scope to All to search everything on it.'
    ])
  })

  it('names a reason this build does not know rather than inventing one', () => {
    expect(lines(viewFor({ kind: 'unavailable', reason: 'quota' }))).toEqual([
      'Session search is unavailable on Studio (quota).'
    ])
  })

  it('says the index changed under a paged search', () => {
    expect(viewFor({ kind: 'index-changed' })).toMatchObject({
      notice: {
        lines: ['The index on Studio changed while searching. Search again for current results.'],
        retry: true
      }
    })
  })

  it('refuses to widen a workspace the host did not list', () => {
    expect(lines(searchScopeUnresolvedView('Studio'))).toEqual([
      'Session search cannot narrow to this workspace, because Studio did not list it among its worktrees.',
      'Switch the scope to All to search everything on it.'
    ])
  })

  it('never names a platform in any sentence it can say', () => {
    const states: SessionSearchState[] = [
      { kind: 'waiting' },
      { kind: 'unavailable', reason: 'disabled' },
      { kind: 'unavailable', reason: 'not-ready' },
      { kind: 'unavailable', reason: 'no-service' },
      { kind: 'unavailable', reason: 'scope-unknown' },
      { kind: 'index-changed' },
      { kind: 'unsupported' },
      results({ hits: [], truncated: true })
    ]
    const said = [
      ...states.flatMap((state) => lines(viewFor(state, BUILDING, UNNAMED_HOST_LABEL))),
      ...lines(searchScopeUnresolvedView(UNNAMED_HOST_LABEL))
    ]
    expect(said.filter((line) => PLATFORM_WORDS.test(line))).toEqual([])
  })
})
