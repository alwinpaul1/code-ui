import { memo, useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { MobilePullToRefresh } from './mobile-pull-to-refresh'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { useForceReconnect } from '../transport/client-context'
import { connectionRetryAction } from '../transport/connection-retry-action'
import { gitCommitCompareRead } from './mobile-git-read-operations'
import type { MobileGitChangedFile } from './git-compare-reply-schema'
import {
  fetchMobileGitHistory,
  mapMobileCommitRows,
  type MobileCommitRow
} from './mobile-git-history'
import { resolveMobileHistoryScreenView } from './mobile-history-screen-state'

type Props = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  // Needed so Retry can revive a parked reconnect loop (STA-1511 / #5049).
  hostId: string
  bottomInset: number
  // Bumped by the hub header refresh so History reloads without remounting.
  refreshNonce?: number
  pullToRefresh?: MobilePullToRefresh
}

// Headerless commit-history list. Extracted from the /history route so the hub's
// History segment and the standalone route render the same body over one code path.
// Memoized: it stays mounted (hidden) while the Changes segment is active, and must
// not re-reconcile its FlatList on every commit-message keystroke re-render.
export const MobileGitHistoryList = memo(function MobileGitHistoryList({
  client,
  connState,
  worktreeId,
  hostId,
  bottomInset,
  refreshNonce = 0,
  pullToRefresh
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(gitHistoryListStyles)
  const forceReconnect = useForceReconnect()
  const [rows, setRows] = useState<MobileCommitRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 'error': the read failed or was refused. Never `[]`, which is a commit with no file changes.
  const [filesById, setFilesById] = useState<
    Record<string, MobileGitChangedFile[] | 'loading' | 'error'>
  >({})
  const [filesAttempt, setFilesAttempt] = useState(0)

  // Host or worktree identity change must wipe history immediately — even while
  // disconnected — so a kept-mounted hub segment never shows another tree's commits.
  useEffect(() => {
    setRows(null)
    setError(null)
    setExpanded(null)
    setFilesById({})
  }, [hostId, worktreeId])

  useEffect(() => {
    let active = true
    if (!client || connState !== 'connected' || !worktreeId) {
      // Why: leave already-loaded rows (and expand state) alone across a drop —
      // resolveMobileHistoryScreenView keeps them visible (STA-1511).
      return
    }
    // Why (F10): clear only the error (it wins render precedence, so a stale one would outlive a
    // successful retry) — the loaded rows stay up until fresh ones land instead of flashing empty.
    setError(null)
    void (async () => {
      try {
        const result = await fetchMobileGitHistory(client, worktreeId)
        if (active) {
          setRows(mapMobileCommitRows(result, Date.now()))
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load history')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [client, connState, reloadNonce, refreshNonce, worktreeId])

  // Why: retrying the fetch is useless while the transport's reconnect loop
  // is parked at its backoff cap — revive the connection instead (mirrors
  // MobileSourceControlPanel / issue #5049). The load effect re-runs via
  // connState once the fresh client connects.
  const retryAction = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => setReloadNonce((n) => n + 1)
  })
  const retry =
    retryAction === null
      ? null
      : () => {
          setError(null)
          retryAction()
        }

  const toggleCommit = useCallback((row: MobileCommitRow) => {
    setExpanded((current) => (current === row.id ? null : row.id))
  }, [])

  // Why (F10): the expanded commit's files load here, not in the tap handler, so a row expanded
  // during an outage refetches on reconnect instead of caching the outage's answer forever.
  useEffect(() => {
    if (!expanded || !client || connState !== 'connected') {
      return
    }
    const commitId = expanded
    let stale = false
    // A failed read shows the spinner again while it is read anew (on Retry, or on the next
    // connection: this effect keys on connState).
    setFilesById((prev) =>
      prev[commitId] && prev[commitId] !== 'error' ? prev : { ...prev, [commitId]: 'loading' }
    )
    // Keep an already-loaded list across a failed refresh; a first load that fails is 'error'
    // ("Couldn't load files" with Retry), never `[]`, which would claim the commit changed nothing.
    const fail = (why: string): void => {
      if (stale) {
        return
      }
      console.warn(`[git-history] files of commit ${commitId} not loaded: ${why || 'no reason given'}`)
      setFilesById((prev) =>
        Array.isArray(prev[commitId]) ? prev : { ...prev, [commitId]: 'error' }
      )
    }
    void gitCommitCompareRead
      .request(client, { worktree: `id:${worktreeId}`, commitId })
      .then((reply) => {
        const compared = gitCommitCompareRead.interpret(reply)
        if (!compared.accepted) {
          fail(reply.ok ? 'the reply carried no result' : `refused: ${reply.error.message}`)
          return
        }
        if (!stale) {
          setFilesById((prev) => ({ ...prev, [commitId]: compared.value.entries }))
        }
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
    return () => {
      stale = true
    }
  }, [client, connState, expanded, filesAttempt, worktreeId])

  const retryFiles = useCallback((commitId: string) => {
    setFilesById((prev) => ({ ...prev, [commitId]: 'loading' }))
    setFilesAttempt((count) => count + 1)
  }, [])

  const connected = client !== null && connState === 'connected'

  const renderCommit = useCallback(
    ({ item }: { item: MobileCommitRow }) => {
      const files = filesById[item.id]
      const isOpen = expanded === item.id
      return (
        <View style={styles.commit}>
          <Pressable
            style={({ pressed }) => [styles.commitHeader, pressed && styles.commitHeaderPressed]}
            onPress={() => toggleCommit(item)}
          >
            {isOpen ? (
              <ChevronDown size={14} color={colors.textMuted} />
            ) : (
              <ChevronRight size={14} color={colors.textMuted} />
            )}
            <View style={styles.commitMain}>
              <Text style={styles.commitSubject} numberOfLines={1}>
                {item.subject}
              </Text>
              <Text style={styles.commitMeta} numberOfLines={1}>
                {item.shortId} · {item.author} · {item.relativeTime}
              </Text>
            </View>
          </Pressable>
          {isOpen ? (
            <View style={styles.files}>
              {files === 'loading' || files === undefined ? (
                // No request can complete while disconnected, so say so instead of spinning forever.
                connected ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text style={styles.empty}>Waiting for desktop...</Text>
                )
              ) : files === 'error' ? (
                <View style={styles.filesError}>
                  <Text style={styles.empty}>Couldn't load files</Text>
                  <Pressable
                    style={styles.filesRetryButton}
                    onPress={() => retryFiles(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading the files of this commit"
                  >
                    <Text style={styles.filesRetryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : files.length === 0 ? (
                <Text style={styles.empty}>No file changes</Text>
              ) : (
                files.map((file) => (
                  <View key={file.path} style={styles.fileRow}>
                    <Text style={styles.filePath} numberOfLines={1}>
                      {file.path}
                    </Text>
                    <Text style={styles.fileStat}>
                      {file.added ? <Text style={styles.add}>+{file.added} </Text> : null}
                      {file.removed ? <Text style={styles.del}>-{file.removed}</Text> : null}
                    </Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>
      )
    },
    // colors and styles come from the theme now, not a static import: without them the rows keep
    // the scheme they were made under after an appearance change.
    [colors, connected, expanded, filesById, retryFiles, styles, toggleCommit]
  )

  const view = resolveMobileHistoryScreenView({ connected, rows, error })

  if (view.kind === 'error' || view.kind === 'waiting') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>
          {view.kind === 'waiting' ? 'Waiting for desktop...' : view.message}
        </Text>
        {retry ? (
          <Pressable style={styles.retryButton} onPress={retry} accessibilityLabel="Retry">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }
  if (view.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }
  if (view.kind === 'empty') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>No commits.</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={view.rows}
      renderItem={renderCommit}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{ paddingBottom: spacing.lg + bottomInset }}
      refreshControl={
        pullToRefresh ? (
          <RefreshControl
            refreshing={pullToRefresh.refreshing}
            onRefresh={pullToRefresh.onRefresh}
            tintColor={colors.textSecondary}
            colors={[colors.textSecondary]}
          />
        ) : undefined
      }
    />
  )
})

function gitHistoryListStyles({ colors }: Theme) {
  return StyleSheet.create({
    state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    stateText: { color: colors.textMuted, fontSize: typography.bodySize },
    retryButton: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    retryText: { color: colors.text, fontSize: typography.bodySize, fontWeight: '600' },
    commit: { borderBottomWidth: 1, borderBottomColor: colors.border },
    commitHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2
    },
    commitHeaderPressed: { backgroundColor: colors.bgRaised },
    commitMain: { flex: 1, minWidth: 0 },
    commitSubject: { color: colors.text, fontSize: typography.bodySize },
    commitMeta: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      fontFamily: typography.monoFamily,
      marginTop: 2
    },
    files: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 4 },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    filePath: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontFamily: typography.monoFamily
    },
    fileStat: { fontSize: typography.metaSize, fontFamily: typography.monoFamily },
    add: { color: colors.diffAddText },
    del: { color: colors.diffDelText },
    empty: { color: colors.textMuted, fontSize: typography.metaSize },
    filesError: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    filesRetryButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    filesRetryText: { color: colors.text, fontSize: typography.metaSize, fontWeight: '600' }
  })
}
