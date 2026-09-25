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
  hostAncestors,
  screenTexts,
  textNode
} from './agent-session-search-screen.test-support'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { AgentSessionSearchStatus } from './agent-history-search-reply-schema'

/**
 * What the search panel says about the host's index, and how it notices the index changing.
 *
 * The phone cannot turn search on: stock Orca keeps `aiVault.setSearchEnabled` off the mobile
 * allowlist and the setting out of the client-writable keys. So an off index has to say where the
 * switch is, by the host's own name, and the panel has to notice by itself when its owner flips it,
 * because Orca pushes no event for the change. These drive the status poll with fake timers.
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
import { SEARCH_STATUS_POLL_MS, SEARCH_STATUS_RETRY_MS } from './use-agent-session-search-status'

const OFF_ON_STUDIO =
  'Session search is off on Studio. Turn it on in Orca on that computer: Settings → Agent Session Search.'

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
 * A host whose index is whatever `index.current` says when asked, so a suite can turn search on
 * "at the desktop" between two polls. The search answers the way Orca's does for that index.
 */
type IndexOnHost = { current: AgentSessionSearchStatus | 'refuse' | 'no-method' }

function indexHost(
  index: IndexOnHost,
  options: {
    search?: () => HostReply
    statusGet?: Record<string, unknown>
  } = {}
): Responder {
  const history = historyReplies([historySession()], (method) => {
    switch (method) {
      case 'aiVault.searchStatus':
        if (index.current === 'refuse') {
          return refused('internal', 'status unavailable')
        }
        if (index.current === 'no-method') {
          return refused('method_not_found', 'Unknown method: aiVault.searchStatus')
        }
        return ok(index.current)
      case 'aiVault.searchSessions':
        if (options.search) {
          return options.search()
        }
        if (typeof index.current === 'string') {
          return ok(searchResults([searchHit()]))
        }
        if (!index.current.enabled) {
          return ok({ kind: 'unavailable', reason: 'disabled' })
        }
        return ok(
          index.current.phase === 'indexing'
            ? { kind: 'unavailable', reason: 'not-ready' }
            : searchResults([searchHit()])
        )
      default:
        return refused('method_not_found', `${method} is not answered by this suite`)
    }
  })
  return (method, params) =>
    method === 'status.get' && options.statusGet ? ok(options.statusGet) : history(method, params)
}

async function mountSearching(
  responder: Responder,
  query = 'scope',
  scheme: 'light' | 'dark' = 'light'
): Promise<{ host: AnsweringClient; rendered: ReactTestRenderer }> {
  const host = createAnsweringClient(responder)
  searchHostConnection.set({ client: host.client, state: 'connected' })
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileAgentSessionHistoryPanel hostId="host-a" worktreeId="wt-1" name="app" />
      </ThemeProvider>
    )
  })
  await flush()
  if (tree === null) {
    throw new Error('the panel did not mount')
  }
  const rendered = tree
  const input = rendered.root.find((node) => String(node.type) === 'TextInput')
  await act(async () => {
    input.props.onChangeText(query)
  })
  await advance(SESSION_SEARCH_DEBOUNCE_MS)
  return { host, rendered }
}

function statusReads(host: AnsweringClient): number {
  return host.sent('aiVault.searchStatus').length
}

describe('saying search is off, by the host own name', () => {
  it('says where to turn it on, in the panel where the results would be', async () => {
    const { rendered } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }), 'zzz')
    const sentence = textNode(rendered, OFF_ON_STUDIO)
    // No loaded session matches "zzz", so the notice stands alone in the panel's own scroll view.
    expect(hostAncestors(sentence)).toContain('ScrollView')
    expect(hasText(rendered, '1 result')).toBe(false)
  })

  it('draws the loaded sessions that match under the notice, as the box did before search', async () => {
    const { rendered } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }), 'vault')
    const sentence = textNode(rendered, OFF_ON_STUDIO)
    expect(hostAncestors(sentence)).toContain('SectionList')
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining(['Loaded sessions that match', 'Implement vault filters'])
    )
  })

  it('names a Windows host by its own name and never a platform word', async () => {
    searchStoredHosts.set([storedHost('host-a', 'DESKTOP-7Q2')])
    const { rendered } = await mountSearching(
      indexHost(
        { current: searchStatus({ enabled: false }) },
        { statusGet: { capabilities: ['aiVault.v1'], hostPlatform: 'win32' } }
      ),
      'zzz'
    )
    expect(
      hasText(
        rendered,
        'Session search is off on DESKTOP-7Q2. Turn it on in Orca on that computer: Settings → Agent Session Search.'
      )
    ).toBe(true)
    const said = screenTexts(rendered).join('\n').replace(/DESKTOP-7Q2/g, '')
    expect(said).not.toMatch(/\b(Mac|macOS|Windows|PC|Linux)\b/)
  })

  it.each([
    ['a blank name', [storedHost('host-a', '   ')]],
    ['no stored entry at all', [storedHost('host-b', 'Other')]]
  ])('says "this computer" for a host with %s', async (_label, hosts) => {
    searchStoredHosts.set(hosts)
    const { rendered } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }), 'zzz')
    expect(
      hasText(
        rendered,
        'Session search is off on this computer. Turn it on in Orca on that computer: Settings → Agent Session Search.'
      )
    ).toBe(true)
  })

  it('never asks the host to turn search on, or to change a setting', async () => {
    const { host } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }))
    await advance(SEARCH_STATUS_POLL_MS * 3)
    expect(host.requests.map((request) => request.method)).not.toEqual(
      expect.arrayContaining(['aiVault.setSearchEnabled'])
    )
    expect(host.sent('settings.update')).toEqual([])
  })
})

describe('saying the index is still building', () => {
  it('shows how many sessions and messages are searchable so far', async () => {
    const { rendered } = await mountSearching(
      indexHost({
        current: searchStatus({ phase: 'indexing', filesIndexed: 12, filesDue: 28, messagesIndexed: 3400 })
      })
    )
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining([
        'Session search is still building its index on Studio.',
        '12 of 40 sessions · 3400 messages searchable',
        'Results appear here when it is ready.'
      ])
    )
  })

  it('shows sessions only for a host that does not count messages', async () => {
    const { messagesIndexed: _dropped, ...older } = searchStatus({
      phase: 'indexing',
      filesIndexed: 12,
      filesDue: 28
    })
    const { rendered } = await mountSearching(indexHost({ current: older }))
    expect(hasText(rendered, '12 of 40 sessions searchable')).toBe(true)
  })

  it("shows the host's own reason for what it could not index", async () => {
    const { rendered } = await mountSearching(
      indexHost({
        current: searchStatus({
          phase: 'indexing',
          filesDue: 2,
          degradedRoots: [{ reason: 'OpenCode-in-WSL is not searchable from Windows yet' }]
        })
      })
    )
    expect(screenTexts(rendered)).toEqual(
      expect.arrayContaining([
        '1 session folder could not be checked.',
        'OpenCode-in-WSL is not searchable from Windows yet'
      ])
    )
  })

  it('moves the progress on by itself as the pass reads more', async () => {
    const index: IndexOnHost = {
      current: searchStatus({ phase: 'indexing', filesIndexed: 12, filesDue: 28 })
    }
    const { rendered } = await mountSearching(indexHost(index))
    index.current = searchStatus({ phase: 'indexing', filesIndexed: 30, filesDue: 10 })
    await advance(SEARCH_STATUS_POLL_MS)
    expect(hasText(rendered, '30 of 40 sessions · 3400 messages searchable')).toBe(true)
  })
})

describe('noticing search being turned on at the desktop', () => {
  it('turns an off panel into results with no tap, and stops asking once ready', async () => {
    const index: IndexOnHost = { current: searchStatus({ enabled: false }) }
    const { host, rendered } = await mountSearching(indexHost(index), 'zzz')
    expect(hasText(rendered, OFF_ON_STUDIO)).toBe(true)

    index.current = searchStatus()
    await advance(SEARCH_STATUS_POLL_MS)
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(screenTexts(rendered)).toEqual(expect.arrayContaining(['1 result', 'Implement vault filters']))
    expect(hasText(rendered, OFF_ON_STUDIO)).toBe(false)

    const readsAtReady = statusReads(host)
    await advance(SEARCH_STATUS_POLL_MS * 10)
    expect(statusReads(host)).toBe(readsAtReady)
  })

  it('goes from off through building to results as the first pass runs', async () => {
    const index: IndexOnHost = { current: searchStatus({ enabled: false }) }
    const { rendered } = await mountSearching(indexHost(index))
    index.current = searchStatus({ phase: 'indexing', filesIndexed: 5, filesDue: 35 })
    await advance(SEARCH_STATUS_POLL_MS)
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(hasText(rendered, '5 of 40 sessions · 3400 messages searchable')).toBe(true)
    index.current = searchStatus()
    await advance(SEARCH_STATUS_POLL_MS)
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(hasText(rendered, '1 result')).toBe(true)
  })

  it('stops asking while another screen covers the panel, and asks again on return', async () => {
    const { host } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }))
    await advance(SEARCH_STATUS_POLL_MS)
    const before = statusReads(host)
    expect(before).toBeGreaterThanOrEqual(2)
    await act(async () => searchFocus.setFocused(false))
    await advance(SEARCH_STATUS_POLL_MS * 10)
    expect(statusReads(host)).toBe(before)
    await act(async () => searchFocus.setFocused(true))
    await flush()
    expect(statusReads(host)).toBe(before + 1)
  })

  it('stops asking in the background, and asks again the moment the app is back', async () => {
    const { host } = await mountSearching(indexHost({ current: searchStatus({ enabled: false }) }))
    const before = statusReads(host)
    await act(async () => searchAppState.emit('background'))
    await advance(SEARCH_STATUS_POLL_MS * 10)
    expect(statusReads(host)).toBe(before)
    await act(async () => searchAppState.emit('active'))
    await flush()
    expect(statusReads(host)).toBe(before + 1)
  })

  it('does not spin on a status read that fails: one slow retry, not the poll', async () => {
    const index: IndexOnHost = { current: 'refuse' }
    const { host, rendered } = await mountSearching(indexHost(index))
    expect(statusReads(host)).toBe(1)
    // The read went out when the panel mounted, one debounce before mountSearching returned.
    await advance(SEARCH_STATUS_POLL_MS * 3)
    expect(statusReads(host)).toBe(1)
    await advance(SEARCH_STATUS_RETRY_MS - SEARCH_STATUS_POLL_MS * 3 - SESSION_SEARCH_DEBOUNCE_MS - 1)
    expect(statusReads(host)).toBe(1)
    await advance(1)
    expect(statusReads(host)).toBe(2)
    // The search itself does not wait on the status.
    expect(hasText(rendered, '1 result')).toBe(true)
  })

  it('stops asking a host that has no status method at all', async () => {
    const { host } = await mountSearching(indexHost({ current: 'no-method' }))
    await advance(SEARCH_STATUS_RETRY_MS * 3)
    expect(statusReads(host)).toBe(1)
  })

  it('asks again on every new connection, once', async () => {
    const { host } = await mountSearching(indexHost({ current: 'refuse' }))
    expect(statusReads(host)).toBe(1)
    await act(async () => searchLastConnectedAt.set(2_000))
    await flush()
    expect(statusReads(host)).toBe(2)
    await act(async () => searchLastConnectedAt.set(2_000))
    await flush()
    expect(statusReads(host)).toBe(2)
  })
})

describe('a search that failed before the connection came back', () => {
  it('runs again once on the new connection, and not on every render', async () => {
    let calls = 0
    const { host, rendered } = await mountSearching(
      indexHost(
        { current: searchStatus() },
        {
          search: () => {
            calls += 1
            return calls === 1 ? refused('timeout', 'The request timed out') : ok(searchResults([searchHit()]))
          }
        }
      )
    )
    expect(hasText(rendered, 'Could not search Studio: The request timed out')).toBe(true)
    await act(async () => searchLastConnectedAt.set(2_000))
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(host.sent('aiVault.searchSessions')).toHaveLength(2)
    expect(hasText(rendered, '1 result')).toBe(true)
    await advance(SEARCH_STATUS_RETRY_MS)
    expect(host.sent('aiVault.searchSessions')).toHaveLength(2)
  })

  it('waits for the host by name while the connection is down', async () => {
    const { rendered } = await mountSearching(indexHost({ current: searchStatus() }))
    const { client } = searchHostConnection.get()
    await act(async () => searchHostConnection.set({ client, state: 'disconnected' }))
    await flush()
    expect(hasText(rendered, 'Waiting for Studio…')).toBe(true)
  })
})

describe('pull-to-refresh on the search panel', () => {
  it('reads the index, the search and the loaded list again, and lets go once they answer', async () => {
    const { host, rendered } = await mountSearching(indexHost({ current: searchStatus() }))
    const reads = {
      status: statusReads(host),
      search: host.sent('aiVault.searchSessions').length,
      list: host.sent('aiVault.listSessions').length
    }
    const control = () => rendered.root.find((node) => String(node.type) === 'RefreshControl')
    await act(async () => control().props.onRefresh())
    expect(control().props.refreshing).toBe(true)
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(control().props.refreshing).toBe(false)
    expect(statusReads(host)).toBe(reads.status + 1)
    expect(host.sent('aiVault.searchSessions')).toHaveLength(reads.search + 1)
    expect(host.sent('aiVault.listSessions')).toHaveLength(reads.list + 1)
    expect(host.sent('aiVault.listSessions').at(-1)?.params).toMatchObject({ force: true })
  })

  it('lets go of the spinner when the search it waited on fails', async () => {
    let calls = 0
    const { rendered } = await mountSearching(
      indexHost(
        { current: searchStatus() },
        {
          search: () => {
            calls += 1
            return calls === 1 ? ok(searchResults([searchHit()])) : refused('internal', 'index exploded')
          }
        }
      )
    )
    const control = () => rendered.root.find((node) => String(node.type) === 'RefreshControl')
    await act(async () => control().props.onRefresh())
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    expect(control().props.refreshing).toBe(false)
    expect(hasText(rendered, 'Could not search Studio: index exploded')).toBe(true)
  })
})

describe('the index notices in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the off and building notices from the %s theme', async (scheme, palette) => {
    const index: IndexOnHost = { current: searchStatus({ enabled: false }) }
    const { rendered } = await mountSearching(indexHost(index), 'zzz', scheme)
    const off = textNode(rendered, OFF_ON_STUDIO)
    expect(flatStyle(off.props.style).color).toBe(palette.text)
    expect(flatStyle(off.parent?.props.style)).toMatchObject({
      backgroundColor: palette.bgPanel,
      borderColor: palette.border
    })

    index.current = searchStatus({ phase: 'indexing', filesIndexed: 5, filesDue: 35 })
    await advance(SEARCH_STATUS_POLL_MS)
    await advance(SESSION_SEARCH_DEBOUNCE_MS)
    const progress = textNode(rendered, '5 of 40 sessions · 3400 messages searchable')
    expect(flatStyle(progress.props.style).color).toBe(palette.textSecondary)
    expect(flatStyle(progress.parent?.props.style).backgroundColor).toBe(palette.bgPanel)
  })

  it('does not paint the notice colours alike in the two schemes', () => {
    expect(lightColors.bgPanel).not.toBe(darkColors.bgPanel)
    expect(lightColors.border).not.toBe(darkColors.border)
  })
})
