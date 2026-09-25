import { describe, expect, it } from 'vitest'
import { searchHit, searchResults, searchStatus } from './agent-session-search.test-support'
import { agentSessionSearch, agentSessionSearchStatusRead } from './agent-history-search-operations'
import {
  agentSessionSearchResponseSchema,
  type AgentSessionSearchResponse
} from './agent-history-search-reply-schema'
import { searchEvidenceRoleLabel, searchSnippetRuns } from './agent-history-search-snippet'
import {
  searchIndexNeedsPolling,
  searchIndexProgressLine,
  searchIndexStateFromStatus,
  type SearchIndexState
} from './agent-history-search-index-state'
import {
  firstPageSearchState,
  nextPageSearchState,
  shouldRerunSearchForIndex,
  type SessionSearchResults
} from './agent-history-search-state'

/**
 * What a session-search reply means, one reading at a time. The panel suites drive these through
 * the wire; these pin each rule where it lives, including the edges a typical page never visits.
 */

function reply(result: unknown) {
  return { id: 'reply', ok: true as const, result }
}

function response(result: unknown): AgentSessionSearchResponse {
  return agentSessionSearchResponseSchema.parse(result)
}

function resultsState(state: ReturnType<typeof firstPageSearchState>): SessionSearchResults {
  if (state.kind !== 'results') {
    throw new Error(`expected results, got ${state.kind}`)
  }
  return state
}

describe('reading a search reply from a newer host', () => {
  it('keeps a hit from an agent this build has never heard of instead of refusing the page', () => {
    const read = agentSessionSearch.interpret(
      reply(searchResults([searchHit({ agent: 'pi-coder', sessionId: 'p-1' }), searchHit()]))
    )
    expect(read.kind === 'results' && read.hits.map((hit) => hit.agent)).toEqual([
      'pi-coder',
      'claude'
    ])
  })

  it('reads an unavailable reason it does not know, so the panel can name it', () => {
    expect(agentSessionSearch.interpret(reply({ kind: 'unavailable', reason: 'quota' }))).toEqual({
      kind: 'unavailable',
      reason: 'quota'
    })
  })

  it('refuses a page whose hits are not a list, rather than drawing half a reply', () => {
    expect(() =>
      agentSessionSearch.interpret(reply({ ...searchResults([]), hits: 'nope' }))
    ).toThrow('The host sent a reply this app could not read (aiVault.searchSessions)')
  })

  it('reads a status from a host older than messagesIndexed', () => {
    const { messagesIndexed: _dropped, ...older } = searchStatus()
    expect(agentSessionSearchStatusRead.interpret(reply(older)).messagesIndexed).toBeUndefined()
  })

  it('refuses a status with no enabled flag, since off and on read the other way round', () => {
    const { enabled: _dropped, ...broken } = searchStatus()
    expect(() => agentSessionSearchStatusRead.interpret(reply(broken))).toThrow(
      'The host sent a reply this app could not read (aiVault.searchStatus)'
    )
  })

  it("raises the host's own message when it refuses the search", () => {
    expect(() =>
      agentSessionSearch.interpret({
        id: 'reply',
        ok: false,
        error: { code: 'internal', message: 'index exploded' }
      })
    ).toThrow('index exploded')
  })
})

describe('marking the matched words in a snippet', () => {
  it('splits plain and matched text at the doubled brackets', () => {
    expect(searchSnippetRuns('add the [[scope]] tabs to [[vault]]')).toEqual([
      { text: 'add the ', match: false },
      { text: 'scope', match: true },
      { text: ' tabs to ', match: false },
      { text: 'vault', match: true }
    ])
  })

  it('draws an empty snippet as nothing at all', () => {
    expect(searchSnippetRuns('')).toEqual([])
  })

  it('draws a snippet that is one match and nothing else', () => {
    expect(searchSnippetRuns('[[scope]]')).toEqual([{ text: 'scope', match: true }])
  })

  it('leaves single brackets from code alone', () => {
    expect(searchSnippetRuns('items[0] and [x]')).toEqual([{ text: 'items[0] and [x]', match: false }])
  })

  it('keeps an unpaired open marker as text instead of swallowing the rest', () => {
    expect(searchSnippetRuns('before [[never closed')).toEqual([
      { text: 'before [[never closed', match: false }
    ])
  })

  it('draws nothing for an empty marker pair', () => {
    expect(searchSnippetRuns('a[[]]b')).toEqual([
      { text: 'a', match: false },
      { text: 'b', match: false }
    ])
  })

  it("labels the turn a match came from in the desktop's words", () => {
    expect(['user', 'assistant', 'tool', 'system', 'reasoning'].map(searchEvidenceRoleLabel)).toEqual([
      'You',
      'Agent',
      'Tool',
      'System',
      'Session'
    ])
  })
})

describe("reading the index's status", () => {
  it('reads a disabled index as off, whatever phase it reports', () => {
    expect(searchIndexStateFromStatus(searchStatus({ enabled: false, phase: 'indexing' }))).toEqual({
      kind: 'off'
    })
  })

  it('reads an indexing pass as building, with sessions and messages so far', () => {
    const state = searchIndexStateFromStatus(
      searchStatus({ phase: 'indexing', filesIndexed: 12, filesDue: 28, messagesIndexed: 3400 })
    )
    expect(state).toEqual({
      kind: 'building',
      progress: { sessionsIndexed: 12, sessionsTotal: 40, messagesIndexed: 3400 },
      notes: []
    })
    expect(state.kind === 'building' && searchIndexProgressLine(state.progress, 'building')).toBe(
      '12 of 40 sessions · 3400 messages searchable'
    )
  })

  it('reads progress in sessions only from a host older than messagesIndexed', () => {
    const { messagesIndexed: _dropped, ...older } = searchStatus({
      phase: 'indexing',
      filesIndexed: 1,
      filesDue: 0
    })
    const state = searchIndexStateFromStatus(older)
    expect(state.kind === 'building' && searchIndexProgressLine(state.progress, 'building')).toBe(
      '1 of 1 session searchable'
    )
  })

  it('reads a degraded pass with files still due as building, and a finished one as ready', () => {
    expect(searchIndexStateFromStatus(searchStatus({ phase: 'degraded', filesDue: 3 })).kind).toBe(
      'building'
    )
    expect(searchIndexStateFromStatus(searchStatus({ phase: 'degraded', filesDue: 0 })).kind).toBe(
      'ready'
    )
  })

  it('reads idle and closed as paused, the desktop\'s "not available right now"', () => {
    expect(searchIndexStateFromStatus(searchStatus({ phase: 'idle' })).kind).toBe('paused')
    expect(searchIndexStateFromStatus(searchStatus({ phase: 'closed' })).kind).toBe('paused')
  })

  it('reads a phase this build does not know as ready, so the poll cannot run forever on it', () => {
    const state = searchIndexStateFromStatus(searchStatus({ phase: 'compacting' }))
    expect(state.kind).toBe('ready')
    expect(searchIndexNeedsPolling(state)).toBe(false)
  })

  it("shows the host's own reason for a root it could not check, once however often it repeats", () => {
    const state = searchIndexStateFromStatus(
      searchStatus({
        phase: 'degraded',
        filesFailed: 1,
        degradedRoots: [
          { reason: 'OpenCode-in-WSL is not searchable from Windows yet' },
          { reason: 'OpenCode-in-WSL is not searchable from Windows yet' }
        ]
      })
    )
    expect(state.kind === 'ready' && state.notes).toEqual([
      '1 session could not be read and will be retried.',
      '2 session folders could not be checked.',
      'OpenCode-in-WSL is not searchable from Windows yet'
    ])
  })

  it('polls while off, building or paused, and stops for ready and every failure', () => {
    const progress = { sessionsIndexed: 0, sessionsTotal: 0, messagesIndexed: null }
    const states: SearchIndexState[] = [
      { kind: 'off' },
      { kind: 'building', progress, notes: [] },
      { kind: 'paused', notes: [] },
      { kind: 'ready', progress, notes: [] },
      { kind: 'checking' },
      { kind: 'unsupported' },
      { kind: 'unreadable', message: 'down' }
    ]
    expect(states.map(searchIndexNeedsPolling)).toEqual([true, true, true, false, false, false, false])
  })

  it('counts an empty index as zero sessions, not one', () => {
    expect(
      searchIndexProgressLine({ sessionsIndexed: 0, sessionsTotal: 0, messagesIndexed: 0 }, 'ready')
    ).toBe('0 sessions · 0 messages searchable')
  })
})

describe('what a page of hits means', () => {
  it('reads an empty first page as no results with nothing more to load', () => {
    expect(resultsState(firstPageSearchState(response(searchResults([]))))).toMatchObject({
      hits: [],
      hasMore: false,
      pages: 1
    })
  })

  it('reads a full page with a cursor as more to load', () => {
    const hits = Array.from({ length: 20 }, (_, index) => searchHit({ sessionId: `s-${index}` }))
    expect(
      resultsState(firstPageSearchState(response(searchResults(hits, { cursor: 'c-2' }))))
    ).toMatchObject({ cursor: 'c-2', hasMore: true })
  })

  it('offers no next page when the host says there is one but sends no cursor', () => {
    expect(
      resultsState(
        firstPageSearchState(response(searchResults([searchHit()], { cursor: null, hasMore: true })))
      ).hasMore
    ).toBe(false)
  })

  it('reads either cursor verdict on a first page as the index changing underneath it', () => {
    expect(firstPageSearchState(response({ kind: 'stale-cursor', generation: 5 }))).toEqual({
      kind: 'index-changed'
    })
    expect(firstPageSearchState(response({ kind: 'malformed-cursor' }))).toEqual({
      kind: 'index-changed'
    })
  })

  it('appends the next page once per session, even when a session straddles two pages', () => {
    const first = resultsState(
      firstPageSearchState(
        response(searchResults([searchHit({ sessionId: 'a' }), searchHit({ sessionId: 'b' })], { cursor: 'c-2' }))
      )
    )
    const next = nextPageSearchState(
      first,
      response(searchResults([searchHit({ sessionId: 'b' }), searchHit({ sessionId: 'c' })]))
    )
    expect(next !== 'restart' && next.kind === 'results' && next.hits.map((hit) => hit.sessionId)).toEqual(
      ['a', 'b', 'c']
    )
    expect(next !== 'restart' && next.kind === 'results' && next.pages).toBe(2)
  })

  it('keeps a session of one agent apart from the same id under another agent', () => {
    const state = resultsState(
      firstPageSearchState(
        response(searchResults([searchHit({ agent: 'claude' }), searchHit({ agent: 'codex' })]))
      )
    )
    expect(state.hits).toHaveLength(2)
  })

  it('asks for page one again on a stale cursor, and gives up on a malformed one', () => {
    const first = resultsState(firstPageSearchState(response(searchResults([searchHit()], { cursor: 'c-2' }))))
    expect(nextPageSearchState(first, response({ kind: 'stale-cursor', generation: 5 }))).toBe('restart')
    expect(nextPageSearchState(first, response({ kind: 'malformed-cursor' }))).toEqual({
      kind: 'index-changed'
    })
  })

  it('reads a truncated candidate set as limited, and freshness alone as not', () => {
    expect(
      resultsState(firstPageSearchState(response(searchResults([], { truncated: true })))).truncated
    ).toBe(true)
    const freshnessOnly = {
      ...searchResults([]),
      truncated: { candidates: false, snippets: 0, query: false, freshness: true }
    }
    expect(resultsState(firstPageSearchState(response(freshnessOnly))).truncated).toBe(false)
  })
})

describe('when a change in the index runs the search again', () => {
  const refusedOff = { kind: 'unavailable' as const, reason: 'disabled' }
  const onePage = resultsState(firstPageSearchState(response(searchResults([searchHit()]))))

  it('re-runs a search refused as disabled once the index turns on', () => {
    expect(shouldRerunSearchForIndex('off', 'building', refusedOff)).toBe(true)
    expect(shouldRerunSearchForIndex('off', 'ready', refusedOff)).toBe(true)
  })

  it('leaves a refusal alone when the reading agrees with it', () => {
    expect(shouldRerunSearchForIndex('checking', 'off', refusedOff)).toBe(false)
    expect(
      shouldRerunSearchForIndex('checking', 'building', { kind: 'unavailable', reason: 'not-ready' })
    ).toBe(false)
  })

  it('does not re-run on the same reading twice, or on a reading that is not settled', () => {
    expect(shouldRerunSearchForIndex('off', 'off', refusedOff)).toBe(false)
    expect(shouldRerunSearchForIndex('off', 'unreadable', refusedOff)).toBe(false)
  })

  it('refreshes one page of results when building finishes, but never a list paged into', () => {
    expect(shouldRerunSearchForIndex('building', 'ready', onePage)).toBe(true)
    expect(shouldRerunSearchForIndex('building', 'ready', { ...onePage, pages: 2 })).toBe(false)
  })

  it('does not re-run results on the first reading, which may simply have answered second', () => {
    expect(shouldRerunSearchForIndex('checking', 'ready', onePage)).toBe(false)
  })
})
