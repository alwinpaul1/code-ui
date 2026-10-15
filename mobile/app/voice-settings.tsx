import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tapTargetHitSlop } from '../src/ui/tap-target'
import { Button } from '../src/ui/Button'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { spacing } from '../src/theme/mobile-theme'
import { useTheme, useThemedStyles } from '../src/theme/theme-context'
import { emptyHostsNoticeCopy, useLoadedHosts } from '../src/transport/use-loaded-hosts'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import { useLastConnectedAt } from '../src/transport/client-context-connection-metrics'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../src/transport/stale-after-reconnect'
import type { RpcClient } from '../src/transport/rpc-client'
import type { ConnectionState } from '../src/transport/types'
import { voiceSettingsStyles } from '../src/components/voice-settings-styles'
import { useDictationSetupPoller } from '../src/dictation/use-dictation-setup-poller'
import {
  fetchDictationSetup,
  setDictationConfig,
  type MobileSpeechSetup
} from '../src/dictation/mobile-dictation-setup'

const POLL_INTERVAL_MS = 1500

const CONNECTING_STATES: ReadonlySet<ConnectionState> = new Set([
  'connecting',
  'handshaking',
  'reconnecting'
])

const DICTATION_MODES = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'hold', label: 'Hold' }
] as const

export default function VoiceSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(voiceSettingsStyles)

  const loadedHosts = useLoadedHosts()
  const { hosts, loaded: hostsLoaded } = loadedHosts
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const { clients: hostClients, focused: routeFocused } = useFocusedSettingsHostClients(hostIds)
  const connected = useMemo(
    () => hostClients.find((entry) => entry.state === 'connected') ?? null,
    [hostClients]
  )
  const client: RpcClient | null = connected?.client ?? null
  const connecting = hostClients.some((entry) => CONNECTING_STATES.has(entry.state))

  // ── Desktop dictation setup ────────────────────────────────────────
  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!client) {
      return false
    }
    try {
      const next = await fetchDictationSetup(client)
      setSetup(next)
      setError(null)
      return false
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice settings')
      return undefined
    }
  }, [client])

  const polling = false
  const refreshSetup = useDictationSetupPoller({
    visible: routeFocused && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  const lastConnectedAt = useLastConnectedAt(connected?.hostId)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())
  useEffect(() => {
    const status = !client ? 'missing' : setup ? 'ready' : error ? 'error' : 'loading'
    const refetch = shouldRefetchAfterReconnect(
      staleLedgerRef.current,
      'voice-setup',
      status,
      lastConnectedAt
    )
    if (refetch && status === 'error') {
      void refreshSetup()
    }
  }, [client, error, lastConnectedAt, refreshSetup, setup])

  const retryRead = useCallback(() => {
    setError(null)
    void refreshSetup()
  }, [refreshSetup])

  const handleSelectMode = useCallback(
    async (dictationMode: 'toggle' | 'hold') => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((prev) => (prev ? { ...prev, dictationMode } : prev))
      try {
        setSetup(await setDictationConfig(client, { dictationMode }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          hitSlop={tapTargetHitSlop(styles.backButton)}
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Voice</Text>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Dictation (requires desktop) ───────────────────────── */}
        {!client ? (
          <View style={[styles.loading, { marginTop: spacing.lg }]}>
            {!hostsLoaded || connecting ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : null}
            {hostsLoaded ? (
              <Text style={[styles.emptyText, { textAlign: 'center' }]}>
                {hosts.length === 0
                  ? emptyHostsNoticeCopy(
                      loadedHosts,
                      'No paired desktops yet. Pair one to change dictation settings.'
                    )
                  : connecting
                    ? 'Connecting to your desktop…'
                    : 'Connect to a desktop to change dictation settings'}
              </Text>
            ) : null}
          </View>
        ) : setup === null && error ? (
          <View style={[styles.loading, { gap: spacing.sm, marginTop: spacing.lg }]}>
            <Text style={styles.rowLabel}>Could not read dictation settings</Text>
            <Text style={[styles.errorText, { textAlign: 'center', paddingVertical: 0 }]}>
              {error}
            </Text>
            <Button label="Retry" variant="secondary" align="center" onPress={retryRead} />
          </View>
        ) : setup === null ? (
          <View style={[styles.loading, { marginTop: spacing.lg }]}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : (
          <>
            <Text style={[styles.groupHeading, styles.inputGroupGap]}>DICTATION</Text>
            {/* No on/off switch: dictation is always on (the user, 2026-10-14). */}
            <View style={[styles.section, styles.sectionTopGap]}>
              <View style={styles.row}>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Dictation Mode</Text>
                  <Text style={styles.rowSublabel}>
                    Toggle: press once to start, again to stop.{'\n'}
                    Hold: dictate while held.
                  </Text>
                </View>
                <View style={styles.segmented}>
                  {DICTATION_MODES.map((mode) => {
                    const active = setup?.dictationMode === mode.value
                    return (
                      <Pressable
                        key={mode.value}
                        onPress={() => void handleSelectMode(mode.value)}
                        style={[styles.segment, active && styles.segmentActive]}
                      >
                        <Text
                          style={[styles.segmentText, active && styles.segmentTextActive]}
                        >
                          {mode.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}
