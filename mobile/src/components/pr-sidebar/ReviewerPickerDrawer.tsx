import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { Check, RotateCw } from 'lucide-react-native'
import { useTheme, useThemedStyles } from '../../theme/theme-context'
import type { GitHubAssignableUser } from '../../../../src/shared/github/pull-request-types'
import type { RpcClient } from '../../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../../transport/stale-after-reconnect'
import { fetchAssignableUsers } from '../../session/github-pr-rpc'
import { BottomDrawer } from '../BottomDrawer'
import { mobilePrSidebarStyles } from './mobile-pr-sidebar-styles'

type Props = {
  visible: boolean
  onClose: () => void
  client: RpcClient | null
  worktreeId: string
  // Moves on each new connection to the host. The client is the same object across reconnects, so
  // this is what lets a failed people read try again once the link is back.
  lastConnectedAt: number | null
  // Logins already requested/reviewing (+ author) — surfaced at the top of the list.
  seededLogins: string[]
  // Resolves the optimistic requested-state for a login (so a just-toggled row reflects it).
  isRequested: (login: string) => boolean
  onToggle: (login: string) => void
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; users: GitHubAssignableUser[] }

// Searchable assignable-user list in a BottomDrawer. Mapped rows (not FlatList):
// this drawer is opened from the PR ScrollView, and a VirtualizedList nested in
// that ScrollView throws and can leave the Reviewers section blank.
// Seeded reviewers + author sort first for quick un-request.
export function ReviewerPickerDrawer({
  visible,
  onClose,
  client,
  worktreeId,
  lastConnectedAt,
  seededLogins,
  isRequested,
  onToggle
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(mobilePrSidebarStyles)
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  const [query, setQuery] = useState('')
  // Bumped by Retry and by a reconnect after a failed read; the load effect keys on it.
  const [attempt, setAttempt] = useState(0)
  const staleLedger = useRef(createStaleAfterReconnectLedger())

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    let cancelled = false
    setLoad({ status: 'loading' })
    void fetchAssignableUsers(client, worktreeId)
      .then((outcome) => {
        if (cancelled) {
          return
        }
        setLoad(
          outcome.ok
            ? { status: 'loaded', users: outcome.result }
            : { status: 'error', message: outcome.error }
        )
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ status: 'error', message: 'Failed to load people' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [visible, client, worktreeId, attempt])

  // A read that failed with the link used to stay a dead end until the drawer was closed and
  // reopened (review round 3, 2026-09-30). It reads again once per NEW connection, never once per
  // render, so a host that stays down is not read in a loop. Idle is left out: the open itself reads.
  // Closing forgets the failure, so a reopen after a reconnect reads once, not once for the open
  // and again for the reconnect.
  useEffect(() => {
    if (!visible) {
      staleLedger.current.clear()
      return
    }
    if (load.status === 'idle') {
      return
    }
    const status = load.status === 'loaded' ? 'ready' : load.status
    if (shouldRefetchAfterReconnect(staleLedger.current, 'people', status, lastConnectedAt)) {
      setAttempt((count) => count + 1)
    }
  }, [visible, load.status, lastConnectedAt])

  const ordered = useMemo(() => {
    if (load.status !== 'loaded') {
      return []
    }
    const seed = new Set(seededLogins.map((l) => l.toLowerCase()))
    // Seeded reviewers sort first so the user can quickly un-request them.
    const sorted = [...load.users].sort((a, b) => {
      const aSeed = seed.has(a.login.toLowerCase()) ? 0 : 1
      const bSeed = seed.has(b.login.toLowerCase()) ? 0 : 1
      return aSeed - bSeed || a.login.localeCompare(b.login)
    })
    const q = query.trim().toLowerCase()
    if (!q) {
      return sorted
    }
    return sorted.filter(
      (u) => u.login.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)
    )
  }, [load, seededLogins, query])

  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss={false}>
      <Text style={styles.pickerTitle}>Reviewers</Text>
      <TextInput
        style={styles.pickerSearch}
        value={query}
        onChangeText={setQuery}
        placeholder="Search people"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {load.status === 'loading' ? (
        <View style={styles.pickerStateArea}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : load.status === 'error' ? (
        <View style={styles.pickerStateArea}>
          <Text style={styles.emptyText}>{load.message}</Text>
          {/* For a read that failed on a link that is up; a reconnect reads again by itself. */}
          <Pressable
            style={styles.retryButton}
            onPress={() => setAttempt((count) => count + 1)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading people"
          >
            <RotateCw size={14} color={colors.text} strokeWidth={2.2} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : ordered.length === 0 ? (
        <View style={styles.pickerStateArea}>
          <Text style={styles.emptyText}>No matching people</Text>
        </View>
      ) : (
        <View style={styles.pickerList}>
          {ordered.map((item) => {
            const requested = isRequested(item.login)
            return (
              <Pressable
                key={item.login}
                style={styles.pickerRow}
                onPress={() => onToggle(item.login)}
                accessibilityRole="button"
                accessibilityState={{ selected: requested }}
                accessibilityLabel={`${requested ? 'Remove' : 'Request'} ${item.login}`}
              >
                <View style={styles.rowTrailing}>
                  {requested ? (
                    <Check size={16} color={colors.text} strokeWidth={2.4} />
                  ) : null}
                </View>
                <View style={styles.pickerRowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name ? `${item.name} (${item.login})` : item.login}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      )}
    </BottomDrawer>
  )
}
