import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tapTargetHitSlop } from '../src/ui/tap-target'
import { Button } from '../src/ui/Button'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { spacing, radii } from '../src/theme/mobile-theme'
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
import {
  startLogin,
  exchangeCode,
  getSavedVerifier,
  clearCredential,
  isLoggedIn as checkAnthropicLoggedIn
} from '../src/dictation/anthropic-auth-store'

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

  // ── Anthropic account ──────────────────────────────────────────────
  const [anthLoggedIn, setAnthLoggedIn] = useState<boolean | null>(null)
  const [anthBusy, setAnthBusy] = useState(false)
  const [anthError, setAnthError] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [showCodeInput, setShowCodeInput] = useState(false)

  useEffect(() => {
    void checkAnthropicLoggedIn().then(setAnthLoggedIn)
  }, [])

  const handleAnthLogin = useCallback(async () => {
    setAnthBusy(true)
    setAnthError(null)
    try {
      await startLogin()
      setShowCodeInput(true)
    } catch (err) {
      setAnthError(err instanceof Error ? err.message : 'Could not open the login page')
    } finally {
      setAnthBusy(false)
    }
  }, [])

  const handleAnthSubmitCode = useCallback(async () => {
    if (!authCode.trim()) {
      return
    }
    setAnthBusy(true)
    setAnthError(null)
    try {
      const verifier = await getSavedVerifier()
      if (!verifier) {
        setAnthError('No login in progress. Tap "Log in" first.')
        return
      }
      await exchangeCode(authCode.trim(), verifier)
      setAnthLoggedIn(true)
      setAuthCode('')
      setShowCodeInput(false)
    } catch (err) {
      setAnthError(err instanceof Error ? err.message : 'Could not exchange code')
    } finally {
      setAnthBusy(false)
    }
  }, [authCode])

  const handleAnthLogout = useCallback(async () => {
    setAnthBusy(true)
    try {
      await clearCredential()
      setAnthLoggedIn(false)
      setAnthError(null)
      setAuthCode('')
      setShowCodeInput(false)
    } finally {
      setAnthBusy(false)
    }
  }, [])

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
        {/* ── Anthropic account ──────────────────────────────────── */}
        <Text style={styles.groupHeading}>ANTHROPIC ACCOUNT</Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          {anthLoggedIn === null ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : anthLoggedIn ? (
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Signed in</Text>
                <Text style={styles.rowSublabel}>
                  Voice transcription uses Anthropic.
                </Text>
              </View>
              <Button
                label="Sign out"
                variant="secondary"
                align="center"
                onPress={() => void handleAnthLogout()}
                disabled={anthBusy}
              />
            </View>
          ) : !showCodeInput ? (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => void handleAnthLogin()}
              disabled={anthBusy}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Sign in to Anthropic</Text>
                <Text style={styles.rowSublabel}>
                  Required for voice dictation.
                </Text>
              </View>
              {anthBusy ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : null}
            </Pressable>
          ) : (
            <View style={styles.row}>
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Text style={styles.rowSublabel}>
                  Paste the code from the browser.
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm
                  }}
                >
                  <TextInput
                    cursorColor={colors.caret}
                    style={{
                      flex: 1,
                      height: 40,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radii.button,
                      paddingHorizontal: spacing.sm,
                      fontFamily: 'monospace',
                      fontSize: 14,
                      color: colors.text,
                      backgroundColor: colors.bg
                    }}
                    placeholder="Auth code"
                    placeholderTextColor={colors.textMuted}
                    value={authCode}
                    onChangeText={setAuthCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    secureTextEntry
                    onSubmitEditing={() => void handleAnthSubmitCode()}
                    returnKeyType="done"
                  />
                  <Button
                    label={anthBusy ? '…' : 'Done'}
                    variant="primary"
                    align="center"
                    onPress={() => void handleAnthSubmitCode()}
                    disabled={anthBusy || !authCode.trim()}
                  />
                </View>
              </View>
            </View>
          )}
          {anthError ? (
            <View style={{ paddingHorizontal: spacing.md + 2, paddingBottom: spacing.sm }}>
              <Text style={styles.error}>{anthError}</Text>
            </View>
          ) : null}
        </View>

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
