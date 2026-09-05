import { useEffect, useState, useCallback } from 'react'
import { View, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { RefreshCw, User } from 'lucide-react-native'
import { loadHosts } from '../../../src/transport/host-store'
import { useHostClient } from '../../../src/transport/client-context'
import { useTheme } from '../../../src/theme/theme-context'
import { useNow } from '../../../src/hooks/use-now'
import { ScreenHeader } from '../../../src/ui/ScreenHeader'
import { IconButton } from '../../../src/ui/IconButton'
import { Txt } from '../../../src/ui/Txt'
import {
  type AccountsSnapshot,
  type ProviderKey,
  decodeAccountsSnapshot,
  getActiveProviderRateLimits,
  getInactiveProviderUsage,
  hasRenderableUsage
} from '../../../src/components/AccountUsage'
import { AccountsProviderCard } from '../../../src/accounts/AccountsProviderCard'
import {
  getActiveCodexAccountIdForRateLimitTarget,
  getCodexResetCreditSummary
} from '../../../src/components/codex-reset-credit'
import { CodexResetCreditAction } from '../../../src/components/CodexResetCreditAction'
import { useCodexResetCreditAction } from '../../../src/components/use-codex-reset-credit-action'

export default function AccountsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()

  // Why: shared client per host. See docs/mobile-shared-client-per-host.md.
  const { client, state: connState } = useHostClient(hostId)
  const [hostName, setHostName] = useState<string>('')
  const [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [clockEnabled, setClockEnabled] = useState(false)

  const acceptSnapshot = useCallback((nextSnapshot: AccountsSnapshot) => {
    setSnapshot(nextSnapshot)
    setError(null)
  }, [])
  const rejectInvalidSnapshot = useCallback(() => {
    // Why: a stale snapshot can expose a finite reset action for the wrong
    // account; fail closed if a host sends a shape this mobile cannot prove.
    setSnapshot(null)
    setError('Invalid accounts snapshot from host')
  }, [])
  const {
    supported: codexResetSupported,
    resetting: resettingCodex,
    resetScope,
    scopeLabel: resetScopeLabel,
    confirmReset: confirmCodexReset
  } = useCodexResetCreditAction({
    client,
    connected: connState === 'connected',
    hostId,
    snapshot,
    accountMutationBusy: busyAccountId !== null,
    onSnapshot: acceptSnapshot
  })

  useFocusEffect(
    useCallback(() => {
      setClockEnabled(true)
      return () => setClockEnabled(false)
    }, [])
  )
  // Why: snapshot pushes only arrive when the desktop's rate-limit poll completes.
  const now = useNow(60_000, clockEnabled)

  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void loadHosts().then((hosts) => {
      if (stale) {
        return
      }
      const host = hosts.find((h) => h.id === hostId)
      if (!host) {
        setError('Host not found')
        return
      }
      setHostName(host.name)
    })
    return () => {
      stale = true
    }
  }, [hostId])

  // Why: subscribe to streaming snapshot updates so usage bars refresh in
  // place when the desktop's rate-limit poll completes (every 5 min) or
  // when the user switches accounts. Falls back to a one-shot accounts.list
  // if the subscription stream errors.
  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    const unsubscribe = client.subscribe('accounts.subscribe', null, (payload) => {
      if (!payload || typeof payload !== 'object') {
        return
      }
      const evt = payload as { type?: string; snapshot?: unknown }
      if (evt.type === 'ready' || evt.type === 'snapshot') {
        try {
          acceptSnapshot(decodeAccountsSnapshot(evt.snapshot))
        } catch {
          rejectInvalidSnapshot()
        }
      }
    })
    return unsubscribe
  }, [acceptSnapshot, client, connState, rejectInvalidSnapshot])

  const refresh = useCallback(async () => {
    if (!client) {
      return
    }
    setRefreshing(true)
    try {
      const res = await client.sendRequest('accounts.list')
      if (res.ok) {
        acceptSnapshot(decodeAccountsSnapshot(res.result))
      } else {
        setError(res.error.message)
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'Invalid accounts snapshot from host') {
        rejectInvalidSnapshot()
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setRefreshing(false)
    }
  }, [acceptSnapshot, client, rejectInvalidSnapshot])

  const selectAccount = useCallback(
    async (provider: ProviderKey, accountId: string | null) => {
      if (!client) {
        return
      }
      const codexTarget = provider === 'codex' ? snapshot?.rateLimits.codexTarget : null
      if (provider === 'codex' && !codexTarget) {
        return
      }
      setBusyAccountId(accountId ?? `${provider}:default`)
      const method =
        provider === 'claude'
          ? 'accounts.selectClaude'
          : codexTarget?.runtime === 'wsl'
            ? 'accounts.selectCodexForTarget'
            : 'accounts.selectCodex'
      try {
        // Why: old hosts silently strip unknown target fields. Use the distinct
        // targeted RPC for WSL so version skew fails before mutating host state.
        const params =
          codexTarget?.runtime === 'wsl' ? { accountId, target: codexTarget } : { accountId }
        const res = await client.sendRequest(method, params)
        if (!res.ok) {
          Alert.alert('Could not switch account', res.error.message)
        } else {
          // Why: optimistic refresh — the streaming subscription will also
          // emit, but a one-shot keeps the UI responsive even if the stream
          // is temporarily disconnected.
          await refresh()
        }
      } catch (e) {
        Alert.alert('Could not switch account', e instanceof Error ? e.message : String(e))
      } finally {
        setBusyAccountId(null)
      }
    },
    [client, refresh, snapshot]
  )

  const renderProvider = (provider: ProviderKey) => {
    if (!snapshot || !hasRenderableUsage(snapshot, provider)) {
      return null
    }
    const state = provider === 'claude' ? snapshot.claude : snapshot.codex
    const activeAccountId =
      provider === 'codex' && snapshot.codex.activeAccountIdsByRuntime
        ? getActiveCodexAccountIdForRateLimitTarget(snapshot)
        : state.activeAccountId
    const activeUsage = getActiveProviderRateLimits(snapshot, provider)
    const activeEmail =
      state.accounts.find((account) => account.id === activeAccountId)?.email ?? null
    const resetCredit = provider === 'codex' ? getCodexResetCreditSummary(activeUsage, now) : null
    const accounts = state.accounts.map((account) => {
      const isActive = activeAccountId === account.id
      const inactive = isActive ? null : getInactiveProviderUsage(snapshot, provider, account.id)
      return {
        id: account.id,
        email: account.email,
        limits: isActive ? activeUsage : (inactive?.rateLimits ?? null),
        isFetching: isActive ? activeUsage?.status === 'fetching' : inactive?.isFetching === true
      }
    })
    return (
      <AccountsProviderCard
        provider={provider}
        activeLimits={activeUsage}
        activeEmail={activeEmail}
        activeAccountId={activeAccountId}
        accounts={accounts}
        now={now}
        busyAccountId={busyAccountId}
        disabled={busyAccountId !== null || resettingCodex || connState !== 'connected'}
        onSelect={(accountId) => void selectAccount(provider, accountId)}
        footer={
          resetCredit && codexResetSupported && resetScope && connState === 'connected' ? (
            <CodexResetCreditAction
              summary={resetCredit}
              scopeLabel={resetScopeLabel}
              busy={resettingCodex}
              disabled={resettingCodex || busyAccountId !== null || connState !== 'connected'}
              onPress={confirmCodexReset}
            />
          ) : null
        }
      />
    )
  }

  const placeholder = (text: string, spinner = true) => (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
      {spinner ? <ActivityIndicator color={colors.textSecondary} /> : null}
      <Txt variant="body" tone={spinner ? 'secondary' : 'danger'} align="center">
        {text}
      </Txt>
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Usage"
        subtitle={hostName || undefined}
        onBack={() => router.back()}
        trailing={
          <IconButton
            icon={RefreshCw}
            accessibilityLabel="Refresh usage"
            onPress={() => void refresh()}
            disabled={!client || refreshing || connState !== 'connected'}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.xl,
          gap: space.lg
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {connState !== 'connected' && !snapshot ? (
          placeholder(`Connecting to ${hostName || 'host'}…`)
        ) : error && !snapshot ? (
          placeholder(error, false)
        ) : !snapshot ? (
          placeholder('Loading usage…')
        ) : (
          <>
            {renderProvider('claude')}
            {renderProvider('codex')}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.xs
              }}
            >
              <User size={14} color={colors.textMuted} />
              <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                Add or re-authenticate accounts from desktop Settings → Accounts.
              </Txt>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
