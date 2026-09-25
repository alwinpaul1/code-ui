import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type RefreshControlProps
} from 'react-native'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import type { RpcClient } from '../transport/rpc-client'
import type { AiVaultScope, AiVaultSearchSort, AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { AgentSessionSearchHit } from './agent-history-search-reply-schema'
import { searchHitKey, type SessionSearchResults } from './agent-history-search-state'
import {
  SEARCH_FALLBACK_CAPTION,
  searchPanelView,
  searchScopeUnresolvedView,
  type SearchNotice,
  type SearchPanelView
} from './agent-history-search-view'
import { agentHistoryStyles } from './agent-history-styles'
import { agentSessionSearchStyles } from './agent-session-search-styles'
import { AgentSessionSearchHitRow } from './AgentSessionSearchHitRow'
import { useAgentSessionSearch } from './use-agent-session-search'
import { useAgentSessionSearchStatus } from './use-agent-session-search-status'
import { useHostDisplayName } from './use-host-display-name'
import { findSearchHitSession, useSearchHitResume } from './use-search-hit-resume'

export type SearchFallbackSlot = (args: {
  header: ReactElement
  refreshing: boolean
  onRefresh: () => void
}) => ReactElement | null

export type AgentSessionSearchPanelProps = {
  hostId: string
  client: RpcClient | null
  connected: boolean
  /** Trimmed and non-empty: the panel is only mounted while there is something to search for. */
  query: string
  scope: AiVaultScope
  scopePaths: readonly string[]
  sessions: readonly AiVaultSession[]
  now: number
  onResumeSession: (session: AiVaultSession) => Promise<void>
  onResumeMessage: (message: string) => void
  onRefreshHistory: () => Promise<void>
  /** The loaded sessions that match, drawn under a notice when the index cannot answer. */
  renderFallback: SearchFallbackSlot
}

/**
 * Orca's Agent Session Search, in the history screen: the query goes to the host's own index
 * (`aiVault.searchSessions`), and the results, or the reason there are none, are drawn where the
 * list was. Everything it says about the index comes from `aiVault.searchStatus`; nothing here can
 * turn indexing on, which is the desktop owner's choice (Settings → Agent Session Search).
 */
export function AgentSessionSearchPanel(props: AgentSessionSearchPanelProps) {
  const host = useHostDisplayName(props.hostId)
  // A scoped tab whose worktree the host did not list has no prefixes to narrow by. Searching
  // unscoped would put every project's sessions under a tab that says Workspace.
  if (props.scope !== 'all' && props.scopePaths.length === 0) {
    return <SearchNoticeOnly {...props} view={searchScopeUnresolvedView(host)} />
  }
  return <AgentSessionSearchResults {...props} host={host} />
}

function AgentSessionSearchResults(props: AgentSessionSearchPanelProps & { host: string }) {
  const { host, hostId, client, connected, query, scopePaths, sessions, now } = props
  const styles = useThemedStyles(agentSessionSearchStyles)
  const listStyles = useThemedStyles(agentHistoryStyles)
  const lastConnectedAt = useLastConnectedAt(hostId)
  const [sort, setSort] = useState<AiVaultSearchSort>('relevance')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const status = useAgentSessionSearchStatus({ client, connected, lastConnectedAt })
  const search = useAgentSessionSearch({
    client,
    connected,
    lastConnectedAt,
    query,
    scopePaths,
    sort,
    indexKind: status.index.kind
  })
  const { resumeHit, resolvingKey } = useSearchHitResume({
    client,
    connected,
    sessions,
    onResumeSession: props.onResumeSession,
    onResumeMessage: props.onResumeMessage
  })
  const { recheck } = status
  const { refresh, retry, loadMore } = search
  const { onRefreshHistory } = props
  const pull = usePullToRefresh(
    useCallback(
      () => Promise.all([recheck(), refresh(), onRefreshHistory()]).then(() => undefined),
      [recheck, refresh, onRefreshHistory]
    )
  )
  const onRetry = useCallback(() => {
    void recheck()
    retry()
  }, [recheck, retry])
  const view = searchPanelView(host, status.index, search.state)

  const renderHit = useCallback(
    ({ item }: { item: AgentSessionSearchHit }) => {
      const key = searchHitKey(item)
      return (
        <AgentSessionSearchHitRow
          hit={item}
          session={findSearchHitSession(sessions, item)}
          expanded={expandedKey === key}
          now={now}
          resume={{ disabled: resolvingKey !== null, loading: resolvingKey === key }}
          onPress={() => setExpandedKey((open) => (open === key ? null : key))}
          onResume={(hit) => void resumeHit(hit)}
        />
      )
    },
    [expandedKey, now, resolvingKey, resumeHit, sessions]
  )

  const sortRow =
    view.kind === 'notice' ? null : (
      <SearchSortRow count={view.kind === 'results' ? view.count : null} sort={sort} onSort={setSort} />
    )
  if (view.kind === 'results') {
    return (
      <View style={styles.body}>
        {sortRow}
        <FlatList
          data={view.results.hits}
          keyExtractor={searchHitKey}
          renderItem={renderHit}
          contentContainerStyle={listStyles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            view.notice ? <SearchNoticeBox notice={view.notice} onRetry={onRetry} /> : null
          }
          ListFooterComponent={<SearchResultsFooter results={view.results} onLoadMore={loadMore} />}
          refreshControl={pull.control}
        />
      </View>
    )
  }
  return (
    <View style={styles.body}>
      {sortRow}
      <SearchNoticeBody {...props} view={view} pull={pull} onRetry={onRetry} />
    </View>
  )
}

/** A notice with nothing to search: only the loaded sessions can answer. */
function SearchNoticeOnly(props: AgentSessionSearchPanelProps & { view: SearchPanelView }) {
  const styles = useThemedStyles(agentSessionSearchStyles)
  const pull = usePullToRefresh(props.onRefreshHistory)
  return (
    <View style={styles.body}>
      <SearchNoticeBody {...props} pull={pull} onRetry={null} />
    </View>
  )
}

function SearchNoticeBody({
  view,
  pull,
  onRetry,
  renderFallback
}: {
  view: SearchPanelView
  pull: PullToRefresh
  onRetry: (() => void) | null
  renderFallback: SearchFallbackSlot
}) {
  const styles = useThemedStyles(agentSessionSearchStyles)
  const listStyles = useThemedStyles(agentHistoryStyles)
  const { colors } = useTheme()
  const notice = view.kind === 'results' ? null : view.notice
  const box = notice ? <SearchNoticeBox notice={notice} onRetry={onRetry} /> : null
  const fallback =
    view.kind === 'notice' && view.fallback
      ? renderFallback({
          header: (
            <View>
              {box}
              <Text style={styles.fallbackCaption}>{SEARCH_FALLBACK_CAPTION}</Text>
            </View>
          ),
          refreshing: pull.refreshing,
          onRefresh: pull.onRefresh
        })
      : null
  if (fallback) {
    return fallback
  }
  return (
    <ScrollView
      contentContainerStyle={listStyles.list}
      keyboardShouldPersistTaps="handled"
      refreshControl={pull.control}
    >
      {view.kind === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : null}
      {box}
    </ScrollView>
  )
}

function SearchSortRow({
  count,
  sort,
  onSort
}: {
  count: string | null
  sort: AiVaultSearchSort
  onSort: (sort: AiVaultSearchSort) => void
}) {
  const styles = useThemedStyles(agentSessionSearchStyles)
  return (
    <View style={styles.sortRow}>
      <Text style={styles.sortCount}>{count ?? ''}</Text>
      {SORT_OPTIONS.map((option) => {
        const active = option.sort === sort
        return (
          <Pressable
            key={option.sort}
            style={[styles.sortOption, active && styles.sortOptionActive]}
            onPress={() => onSort(option.sort)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const SORT_OPTIONS: { sort: AiVaultSearchSort; label: string }[] = [
  { sort: 'relevance', label: 'Most relevant' },
  { sort: 'newest', label: 'Newest' }
]

function SearchNoticeBox({ notice, onRetry }: { notice: SearchNotice; onRetry: (() => void) | null }) {
  const styles = useThemedStyles(agentSessionSearchStyles)
  const [lead, ...details] = notice.lines
  return (
    <View
      style={[
        styles.notice,
        notice.tone === 'warning' && styles.noticeWarning,
        notice.tone === 'danger' && styles.noticeDanger
      ]}
      accessibilityRole={notice.tone === 'info' ? undefined : 'alert'}
    >
      <Text style={styles.noticeLead}>{lead}</Text>
      {details.map((line, index) => (
        <Text key={index} style={styles.noticeDetail}>
          {line}
        </Text>
      ))}
      {notice.retry && onRetry ? (
        <Pressable style={styles.noticeRetry} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.noticeRetryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function SearchResultsFooter({
  results,
  onLoadMore
}: {
  results: SessionSearchResults
  onLoadMore: () => void
}) {
  const styles = useThemedStyles(agentSessionSearchStyles)
  const { colors } = useTheme()
  if (results.loadingMore) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (results.loadMoreError) {
    return (
      <View style={styles.footer}>
        <Text style={styles.loadMoreError}>Could not load more matches: {results.loadMoreError}</Text>
        <Pressable style={styles.loadMore} onPress={onLoadMore} accessibilityRole="button">
          <Text style={styles.loadMoreText}>Try again</Text>
        </Pressable>
      </View>
    )
  }
  if (!results.hasMore) {
    return null
  }
  return (
    <View style={styles.footer}>
      <Pressable style={styles.loadMore} onPress={onLoadMore} accessibilityRole="button">
        <Text style={styles.loadMoreText}>Load more matches</Text>
      </Pressable>
    </View>
  )
}

type PullToRefresh = {
  refreshing: boolean
  onRefresh: () => void
  control: ReactElement<RefreshControlProps>
}

/** Pull-to-refresh the way the history list has it: the spinner holds until the work settles. */
function usePullToRefresh(work: () => Promise<void>): PullToRefresh {
  const { colors } = useTheme()
  const [refreshing, setRefreshing] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void work()
      .catch(() => {
        // Each read reports its own failure on screen; the spinner only has to stop.
      })
      .finally(() => {
        if (mountedRef.current) {
          setRefreshing(false)
        }
      })
  }, [work])
  const control = useMemo(
    () => (
      <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
    ),
    [refreshing, onRefresh, colors.textSecondary]
  )
  return { refreshing, onRefresh, control }
}
