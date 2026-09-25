import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// First, ahead of anything that loads react-native: the mocks below draw with these doubles.
import {
  createAnsweringClient,
  FlatListDouble,
  flatStyle,
  historyReplies,
  historySession,
  ok,
  refused,
  ScrollViewDouble,
  SectionListDouble,
  type AnsweringClient,
  type HostReply,
  type Responder
} from './agent-history-panel.test-support'
import {
  searchAppState,
  searchFocus,
  searchHit,
  searchHostConnection,
  searchLastConnectedAt,
  searchResults,
  searchStatus,
  searchStoredHosts,
  storedHost
} from './agent-session-search.test-support'
import {
  hasText,
  press,
  pressText,
  screenTexts,
  textNode
} from './agent-session-search-screen.test-support'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { AgentSessionSearchHit } from './agent-history-search-reply-schema'

/**
 * Orca's Agent Session Search in the history screen: typing searches the host's index, and the hits
 * are drawn where the list was, paged, sorted, and resumable through the list's own resume.
 *
 * Driven through the whole screen against a host double that answers on the wire, so each case
 * pins what is sent and what the user then sees. The index's own states (off, building, the poll
 * that notices search being turned on) are in agent-session-search-index-watch.test.tsx.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  usePathname: () => '/',
  useFocusEffect: searchFocus.useFocusEffect
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: FlatListDouble,
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: ScrollViewDouble,
  SectionList: SectionListDouble,
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android', select: (choices: Record<string, unknown>) => choices.android },
  AppState: searchAppState.AppState,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Chevron', Play: 'Play', RefreshCw: 'Refresh' }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {}, triggerSuccess: () => {} }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'AgentIcon' }))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ push: () => {}, back: () => {}, canGoBack: () => false })
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => null,
  useHostClient: () => ({ ...searchHostConnection.useValue(), clientId: null })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => searchLastConnectedAt.useValue()
}))
vi.mock('../transport/host-store', () => ({
  loadHosts: () => Promise.resolve(searchStoredHosts.get())
}))

import { MobileAgentSessionHistoryPanel } from './MobileAgentSessionHistoryPanel'
import { SESSION_SEARCH_DEBOUNCE_MS } from './use-agent-session-search'

type SearchParams = { query: string; limit: number; cursor?: string; filters?: Record<string, unknown> }

let tree: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-29T00:00:00.000Z'))
  searchStoredHosts.set([storedHost('host-a', 'Studio')])
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  vi.useRealTimers()
  searchFocus.reset()
  searchAppState.reset()
  searchLastConnectedAt.reset()
  searchHostConnection.reset()
  searchStoredHosts.reset()
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve()
    }
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await flush()
}

/**
 * A host with search on and a ready index, answering the search with `search`. `hostSessions` is
 * what `aiVault.listSessions` answers, read on every call so a suite can change it after mount.
 */
function searchHost(
  search: (params: SearchParams) => HostReply,
  hostSessions: () => readonly AiVaultSession[] = () => [historySession()]
): Responder {
  return (method, params) => {
    if (method === 'aiVault.listSessions') {
      return ok({ sessions: hostSessions(), issues: [] })
    }
    return historyReplies([], (next, nextParams) => {
      switch (next) {
        case 'aiVault.searchStatus':
          return ok(searchStatus())
        case 'aiVault.searchSessions':
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the panel's own request, typed from the catalog; the suite reads it back.
          return search(nextParams as SearchParams)
        default:
          return refused('method_not_found', `${next} is not answered by this suite`)
      }
    })(method, params)
  }
}

async function mountPanel(
  responder: Responder,
  options: { scheme?: 'light' | 'dark'; worktreeId?: string } = {}
): Promise<{ host: AnsweringClient; rendered: ReactTestRenderer }> {
  const host = createAnsweringClient(responder)
  searchHostConnection.set({ client: host.client, state: 'connected' })
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={options.scheme ?? 'light'}>
        <MobileAgentSessionHistoryPanel
          hostId="host-a"
          worktreeId={options.worktreeId ?? 'wt-1'}
          name="app"
        />
      </ThemeProvider>
    )
  })
  await flush()
  if (tree === null) {
    throw new Error('the panel did not mount')
  }
  return { host, rendered: tree }
}

async function typeQuery(rendered: ReactTestRenderer, query: string): Promise<void> {
  const input = rendered.root.find((node) => String(node.type) === 'TextInput')
  await act(async () => {
    input.props.onChangeText(query)
  })
}

async function search(rendered: ReactTestRenderer, query: string): Promise<void> {
  await typeQuery(rendered, query)
  await advance(SESSION_SEARCH_DEBOUNCE_MS)
}

function searchesSent(host: AnsweringClient): SearchParams[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the params the panel sent, read back as the shape it sends.
  return host.sent('aiVault.searchSessions').map((request) => request.params as SearchParams)
}

function page(count: number, from = 0): AgentSessionSearchHit[] {
  return Array.from({ length: count }, (_, index) =>
    searchHit({ sessionId: `s-${from + index}`, title: `Session ${from + index}` })
  )
}

describe('searching as the user types', () => {
  it('sends one search per pause in typing, narrowed to the workspace, with no sort for Most relevant', async () => {
    const { host, rendered } = await mountPanel(searchHost(() => ok(searchResults([searchHit()]))))
    await typeQuery(rendered, 'sco')
    await advance(100)
    await typeQuery(rendered, 'scope')
    await advance(SESSION_SEARCH_DEBOUNCE_MS - 1)
    expect(searchesSent(host)).toEqual([])
    await advance(1)
    expect(searchesSent(host)).toEqual([
      { query: 'scope', limit: 20, filters: { scopePaths: ['/Users/ada/repo/app'] } }
    ])
  })

  it('asks for newest first when Newest is picked, and drops the narrowing under All', async () => {
    const { host, rendered } = await mountPanel(searchHost(() => ok(searchResults([searchHit()]))))
    await search(rendered, 'scope')
    await pressText(rendered, 'Newest')
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    await pressText(rendered, 'All')
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(searchesSent(host).slice(1)).toEqual([
      { query: 'scope', limit: 20, filters: { scopePaths: ['/Users/ada/repo/app'], sort: 'newest' } },
      { query: 'scope', limit: 20, filters: { sort: 'newest' } }
    ])
  })

  it('trims the query, and goes back to the plain list when the box is cleared', async () => {
    const { host, rendered } = await mountPanel(searchHost(() => ok(searchResults([searchHit()]))))
    await search(rendered, '  scope  ')
    expect(searchesSent(host).map((sent) => sent.query)).toEqual(['scope'])
    await search(rendered, '   ')
    expect(searchesSent(host)).toHaveLength(1)
    expect(hasText(rendered, '1 result')).toBe(false)
    expect(hasText(rendered, 'Implement vault filters')).toBe(true)
  })
})

describe('drawing hits', () => {
  it('draws one hit with its match marked, its age, agent and message count', async () => {
    const { rendered } = await mountPanel(searchHost(() => ok(searchResults([searchHit()]))))
    await search(rendered, 'scope')
    const texts = screenTexts(rendered)
    expect(texts).toEqual(
      expect.arrayContaining([
        '1 result',
        'Implement vault filters',
        '5m',
        'You: add the scope tabs to the vault',
        '3 messages'
      ])
    )
    const icon = rendered.root.find((node) => String(node.type) === 'AgentIcon')
    expect(icon.props.agentId).toBe('claude')
  })

  it('says there are no matches in the indexed history when the page is empty', async () => {
    const { rendered } = await mountPanel(searchHost(() => ok(searchResults([]))))
    await search(rendered, 'nothing-matches')
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining([
        '0 results',
        'No matching sessions in the indexed history. Try another query or scope.'
      ])
    )
  })

  it('offers no Resume for a hit whose transcript is gone, and says why', async () => {
    const { rendered } = await mountPanel(
      searchHost(() => ok(searchResults([searchHit({ source: { presence: 'missing' } })])))
    )
    await search(rendered, 'scope')
    expect(hasText(rendered, 'Transcript is no longer available')).toBe(true)
    expect(
      rendered.root.findAll((node) => node.props.accessibilityLabel === 'Resume agent session')
    ).toEqual([])
  })

  it('draws a hit from an agent this build does not know under its own name', async () => {
    const { rendered } = await mountPanel(
      searchHost(() => ok(searchResults([searchHit({ agent: 'pi-coder', messageCount: 1 })])))
    )
    await search(rendered, 'scope')
    expect(screenTexts(rendered)).toEqual(expect.arrayContaining(['pi-coder', '1 message']))
  })
})

describe('paging through hits', () => {
  it('loads the next page from the cursor and appends it', async () => {
    const { host, rendered } = await mountPanel(
      searchHost((params) =>
        ok(params.cursor ? searchResults(page(5, 20)) : searchResults(page(20), { cursor: 'c-2' }))
      )
    )
    await search(rendered, 'session')
    expect(hasText(rendered, '20+ results')).toBe(true)
    await pressText(rendered, 'Load more matches')
    await flush()
    expect(searchesSent(host).map((sent) => sent.cursor)).toEqual([undefined, 'c-2'])
    expect(hasText(rendered, '25 results')).toBe(true)
    expect(hasText(rendered, 'Session 24')).toBe(true)
    expect(hasText(rendered, 'Load more matches')).toBe(false)
  })

  it('starts over from page one when the index moved on between pages', async () => {
    let firstPages = 0
    const { host, rendered } = await mountPanel(
      searchHost((params) => {
        if (params.cursor) {
          return ok({ kind: 'stale-cursor', generation: 5 })
        }
        firstPages += 1
        return ok(firstPages === 1 ? searchResults(page(20), { cursor: 'c-2' }) : searchResults(page(2, 100)))
      })
    )
    await search(rendered, 'session')
    await pressText(rendered, 'Load more matches')
    await flush()
    expect(searchesSent(host).map((sent) => sent.cursor)).toEqual([undefined, 'c-2', undefined])
    expect(hasText(rendered, '2 results')).toBe(true)
    expect(hasText(rendered, 'Session 0')).toBe(false)
  })

  it('keeps the pages on screen when the next one fails, and tries that page again on tap', async () => {
    let failNext = true
    const { host, rendered } = await mountPanel(
      searchHost((params) => {
        if (!params.cursor) {
          return ok(searchResults(page(20), { cursor: 'c-2' }))
        }
        if (failNext) {
          failNext = false
          return refused('internal', 'relay hiccup')
        }
        return ok(searchResults(page(1, 20)))
      })
    )
    await search(rendered, 'session')
    await pressText(rendered, 'Load more matches')
    await flush()
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining(['20+ results', 'Session 19', 'Could not load more matches: relay hiccup'])
    )
    await pressText(rendered, 'Try again')
    await flush()
    expect(searchesSent(host).map((sent) => sent.cursor)).toEqual([undefined, 'c-2', 'c-2'])
    expect(hasText(rendered, '21 results')).toBe(true)
  })

  it('says the index changed when the host cannot read the cursor, and searches again on tap', async () => {
    const { host, rendered } = await mountPanel(
      searchHost((params) =>
        ok(params.cursor ? { kind: 'malformed-cursor' } : searchResults(page(20), { cursor: 'c-2' }))
      )
    )
    await search(rendered, 'session')
    await pressText(rendered, 'Load more matches')
    await flush()
    expect(
      hasText(rendered, 'The index on Studio changed while searching. Search again for current results.')
    ).toBe(true)
    await pressText(rendered, 'Try again')
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(searchesSent(host).map((sent) => sent.cursor)).toEqual([undefined, 'c-2', undefined])
    expect(hasText(rendered, '20+ results')).toBe(true)
  })
})

describe('a search that fails says why', () => {
  it("shows the host's own message for a rejected search, and retries on tap", async () => {
    let calls = 0
    const { host, rendered } = await mountPanel(
      searchHost(() => {
        calls += 1
        return calls === 1 ? refused('internal', 'index exploded') : ok(searchResults([searchHit()]))
      })
    )
    await search(rendered, 'scope')
    expect(hasText(rendered, 'Could not search Studio: index exploded')).toBe(true)
    await pressText(rendered, 'Try again')
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(searchesSent(host)).toHaveLength(2)
    expect(hasText(rendered, '1 result')).toBe(true)
  })

  it('refuses a reply it cannot read instead of drawing half of it', async () => {
    const { rendered } = await mountPanel(
      searchHost(() => ok({ ...searchResults([]), hits: 'nope' }))
    )
    await search(rendered, 'scope')
    expect(
      hasText(
        rendered,
        'Could not search Studio: The host sent a reply this app could not read (aiVault.searchSessions)'
      )
    ).toBe(true)
  })

  it('asks for a newer Orca on a host with no search method, over the sessions it already loaded', async () => {
    const { rendered } = await mountPanel(
      searchHost(() => refused('method_not_found', 'Unknown method: aiVault.searchSessions'))
    )
    await search(rendered, 'vault')
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining([
        'Session search needs a newer Orca on Studio.',
        'Loaded sessions that match',
        'Implement vault filters'
      ])
    )
  })

  it("reads a host whose mobile allowlist predates search the same way, not as a failure", async () => {
    const { rendered } = await mountPanel(
      searchHost(() =>
        refused('forbidden', 'aiVault.searchSessions is not available to mobile clients')
      )
    )
    await search(rendered, 'vault')
    expect(hasText(rendered, 'Session search needs a newer Orca on Studio.')).toBe(true)
  })

  it('will not widen a workspace the host did not list into a search of everything', async () => {
    const { host, rendered } = await mountPanel(
      searchHost(() => ok(searchResults([searchHit()]))),
      { worktreeId: 'wt-missing' }
    )
    await search(rendered, 'scope')
    await advance(1_000)
    expect(searchesSent(host)).toEqual([])
    expect(
      hasText(
        rendered,
        'Session search cannot narrow to this workspace, because Studio did not list it among its worktrees.'
      )
    ).toBe(true)
  })
})

/** A host on an Orca from before session search: neither search method exists. */
function hostWithoutSearch(): Responder {
  return historyReplies([historySession()], (method) =>
    refused('method_not_found', `Unknown method: ${method}`)
  )
}

function spinners(rendered: ReactTestRenderer): number {
  return rendered.root.findAll((node) => String(node.type) === 'ActivityIndicator').length
}

describe('the loaded sessions while the index cannot answer', () => {
  it('keeps the loaded matches on screen, with no spinner, while typing on an Orca without search', async () => {
    const { rendered } = await mountPanel(hostWithoutSearch())
    await search(rendered, 'vault')
    expect(hasText(rendered, 'Implement vault filters')).toBe(true)
    await typeQuery(rendered, 'vaul')
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining(['Session search needs a newer Orca on Studio.', 'Implement vault filters'])
    )
    expect(spinners(rendered)).toBe(0)
  })

  it('draws the loaded matches before a host with search off has answered the status read', async () => {
    let answerStatus: (reply: HostReply) => void = () => {}
    const { rendered } = await mountPanel(
      historyReplies([historySession()], (method) => {
        switch (method) {
          case 'aiVault.searchStatus':
            return new Promise((resolve) => {
              answerStatus = resolve
            })
          case 'aiVault.searchSessions':
            return ok({ kind: 'unavailable', reason: 'disabled' })
          default:
            return refused('method_not_found', `${method} is not answered by this suite`)
        }
      })
    )
    await typeQuery(rendered, 'vault')
    await flush()
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining(['Loaded sessions that match', 'Implement vault filters'])
    )
    await act(async () => answerStatus(ok(searchStatus({ enabled: false }))))
    await flush()
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining([
        'Session search is off on Studio. Turn it on in Orca on that computer: Settings → Agent Session Search.',
        'Implement vault filters'
      ])
    )
  })
})

describe('resuming from a hit', () => {
  it("resumes a hit already in the list through the list's own resume", async () => {
    const { host, rendered } = await mountPanel(searchHost(() => ok(searchResults([searchHit()]))))
    await search(rendered, 'scope')
    const scansBefore = host.sent('aiVault.listSessions').length
    await press(rendered.root.find((node) => node.props.accessibilityLabel === 'Resume agent session'))
    await flush()
    expect(host.sent('aiVault.listSessions')).toHaveLength(scansBefore)
    expect(host.sent('repo.list')).toHaveLength(1)
  })

  it('finds a hit older than the loaded list with one scan of its own folder', async () => {
    let onHost = [historySession()]
    const older = historySession({ id: 'claude:9', sessionId: 'session-9', title: 'Older work' })
    const { host, rendered } = await mountPanel(
      searchHost(
        () => ok(searchResults([searchHit({ sessionId: 'session-9', title: 'Older work' })])),
        () => onHost
      )
    )
    onHost = [historySession(), older]
    await search(rendered, 'older')
    await press(rendered.root.find((node) => node.props.accessibilityLabel === 'Resume agent session'))
    await flush()
    expect(host.sent('aiVault.listSessions').at(-1)?.params).toEqual({
      limit: 500,
      force: false,
      scopePaths: ['/Users/ada/repo/app']
    })
    expect(host.sent('repo.list')).toHaveLength(1)
  })

  it('says so when the host no longer lists the Claude session behind a hit', async () => {
    // For Claude the folder scan reaches past the host's 500-session cap, so a miss is real.
    const { host, rendered } = await mountPanel(
      searchHost(() => ok(searchResults([searchHit({ sessionId: 'session-gone' })])))
    )
    await search(rendered, 'scope')
    await press(rendered.root.find((node) => node.props.accessibilityLabel === 'Resume agent session'))
    await flush()
    expect(
      hasText(
        rendered,
        "The host's session history no longer lists this session, so it cannot be resumed from here."
      )
    ).toBe(true)
    expect(host.sent('repo.list')).toEqual([])
  })

  it('names the history limit, not the host, when a Codex hit is older than the host lists', async () => {
    // Orca's scan keeps the 500 newest sessions and widens past them for a folder only for Claude
    // (discoverInScopeClaudeFiles, origin/main 8d6fec597b), so an older Codex session the index
    // still holds is in no list the phone can ask for.
    const { host, rendered } = await mountPanel(
      searchHost(() => ok(searchResults([searchHit({ agent: 'codex', sessionId: 'session-old' })])))
    )
    await search(rendered, 'scope')
    await press(rendered.root.find((node) => node.props.accessibilityLabel === 'Resume agent session'))
    await flush()
    expect(
      hasText(
        rendered,
        'Studio lists only its 500 most recent sessions, and this one is older, so it cannot be resumed from here. Resume it in Orca on that computer.'
      )
    ).toBe(true)
    expect(screenTexts(rendered).join('\n')).not.toMatch(/no longer lists/)
    expect(host.sent('repo.list')).toEqual([])
  })
})

describe('the search results in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the match, the sort row and a failure from the %s theme', async (scheme, palette) => {
    let calls = 0
    const { rendered } = await mountPanel(
      searchHost(() => {
        calls += 1
        return calls === 1 ? ok(searchResults([searchHit()])) : refused('internal', 'index exploded')
      }),
      { scheme }
    )
    await search(rendered, 'scope')
    const match = textNode(rendered, 'scope')
    expect(flatStyle(match.props.style)).toMatchObject({
      backgroundColor: palette.accentSoft,
      color: palette.text
    })
    expect(flatStyle(textNode(rendered, 'Most relevant').props.style).color).toBe(palette.text)
    expect(flatStyle(textNode(rendered, 'Newest').props.style).color).toBe(palette.textSecondary)
    expect(flatStyle(textNode(rendered, 'Implement vault filters').props.style).color).toBe(
      palette.text
    )
    const refresh = rendered.root.find((node) => String(node.type) === 'RefreshControl')
    expect(refresh.props.tintColor).toBe(palette.textSecondary)

    await pressText(rendered, 'Newest')
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    const failure = textNode(rendered, 'Could not search Studio: index exploded')
    expect(flatStyle(failure.parent?.props.style).backgroundColor).toBe(palette.dangerSoft)
    expect(flatStyle(failure.props.style).color).toBe(palette.text)
  })

  it('does not paint the pinned colours alike in the two schemes', () => {
    expect(lightColors.accentSoft).not.toBe(darkColors.accentSoft)
    expect(lightColors.dangerSoft).not.toBe(darkColors.dangerSoft)
    expect(lightColors.text).not.toBe(darkColors.text)
    expect(lightColors.textSecondary).not.toBe(darkColors.textSecondary)
  })
})
