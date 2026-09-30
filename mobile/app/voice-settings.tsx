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
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
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
import { BottomDrawer } from '../src/components/BottomDrawer'
import { VoiceModelList } from '../src/components/VoiceModelList'
import { VoiceSettingsSwitchRow } from '../src/components/VoiceSettingsSwitchRow'
import { voiceSettingsStyles } from '../src/components/voice-settings-styles'
import { useDictationSetupPoller } from '../src/dictation/use-dictation-setup-poller'
import {
  deleteDictationModel,
  downloadDictationModel,
  fetchDictationSetup,
  isModelInFlight,
  setDictationConfig,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../src/dictation/mobile-dictation-setup'

const POLL_INTERVAL_MS = 1500

// A desktop on its way to connected: the screen says so rather than asking for one.
const CONNECTING_STATES: ReadonlySet<ConnectionState> = new Set([
  'connecting',
  'handshaking',
  'reconnecting'
])

const DICTATION_MODES = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'hold', label: 'Hold' }
] as const

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

export default function VoiceSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(voiceSettingsStyles)

  const loadedHosts = useLoadedHosts()
  const { hosts, loaded: hostsLoaded } = loadedHosts
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const { clients: hostClients, focused: routeFocused } = useFocusedSettingsHostClients(hostIds)
  // Voice dictation runs on the paired desktop, so pick the first connected host.
  const connected = useMemo(
    () => hostClients.find((entry) => entry.state === 'connected') ?? null,
    [hostClients]
  )
  const client: RpcClient | null = connected?.client ?? null
  const connecting = hostClients.some((entry) => CONNECTING_STATES.has(entry.state))

  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!client) {
      return false
    }
    try {
      const next = await fetchDictationSetup(client)
      setSetup(next)
      setError(null)
      return next.models.some(isModelInFlight)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice settings')
      return undefined
    }
  }, [client])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: routeFocused && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  // A first read that failed is read again once per new connection, not per render. With no
  // desktop connected ('missing') the poller owns the next read: it reads when one connects.
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

  // The model sheet's buttons do nothing without a desktop; do not leave it open over one.
  useEffect(() => {
    if (!client) {
      setModelDrawerOpen(false)
    }
  }, [client])

  const retryRead = useCallback(() => {
    setError(null)
    void refreshSetup()
  }, [refreshSetup])

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      // Optimistic flip so the switch responds instantly; reconcile below.
      setSetup((prev) => (prev ? { ...prev, enabled } : prev))
      try {
        setSetup(await setDictationConfig(client, { enabled }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

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

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        if (!client) {
          return
        }
        setSetup(await setDictationConfig(client, { enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusyAction(null)
      }
    },
    [client]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        if (!client) {
          return
        }
        await downloadDictationModel(client, model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, refreshSetup]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      const deletedSelectedModel = setup?.selectedModelId === model.id
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        if (!client) {
          return
        }
        setSetup(await deleteDictationModel(client, model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, setup?.selectedModelId]
  )

  const enabled = setup?.enabled ?? false
  const selectedModel = setup?.models.find((m) => m.id === setup.selectedModelId)
  const selectedModelLabel = selectedModel?.label ?? 'None selected'

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

      {/* The settings live on the desktop. Without one connected, or before its first answer,
          there is nothing true to draw: no switch position, no mode, no model. "Connect to a
          desktop" is for paired desktops that are not connected. With none in the list the line
          says why: nothing paired, a list that could not be read, or a desktop whose credential
          is locked or gone (emptyHostsNoticeCopy). */}
      {!client ? (
        <View style={styles.loading}>
          {!hostsLoaded || connecting ? <ActivityIndicator color={colors.textSecondary} /> : null}
          {hostsLoaded ? (
            <Text style={[styles.emptyText, { textAlign: 'center' }]}>
              {hosts.length === 0
                ? emptyHostsNoticeCopy(
                    loadedHosts,
                    'No paired desktops yet. Pair one to change voice settings.'
                  )
                : connecting
                  ? 'Connecting to your desktop…'
                  : 'Connect to a desktop to change voice settings'}
            </Text>
          ) : null}
        </View>
      ) : setup === null && error ? (
        <View style={[styles.loading, { gap: spacing.sm }]}>
          <Text style={styles.rowLabel}>Couldn't read voice settings</Text>
          <Text style={[styles.errorText, { textAlign: 'center', paddingVertical: 0 }]}>
            {error}
          </Text>
          <Button label="Retry" variant="secondary" align="center" onPress={retryRead} />
        </View>
      ) : setup === null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupHeading}>DICTATION</Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <VoiceSettingsSwitchRow
              label="Enable Voice Dictation"
              sublabel="Dictate text into any focused pane on your desktop."
              value={enabled}
              onValueChange={(v) => void handleToggleEnabled(v)}
            />

            <View style={styles.separator} />

            <View
              style={[styles.row, !enabled && styles.disabled]}
              pointerEvents={enabled ? 'auto' : 'none'}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Dictation Mode</Text>
                <Text style={styles.rowSublabel}>
                  Toggle: press once to start, again to stop. Hold: dictate while held.
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
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {mode.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>

          <Text style={[styles.groupHeading, styles.inputGroupGap]}>SPEECH MODEL</Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                !enabled && styles.disabled,
                pressed && styles.rowPressed
              ]}
              disabled={!enabled}
              onPress={() => setModelDrawerOpen(true)}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Speech Model</Text>
                <Text style={styles.rowSublabel} numberOfLines={1}>
                  {selectedModelLabel}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}

      <BottomDrawer visible={modelDrawerOpen} onClose={() => setModelDrawerOpen(false)}>
        <Text style={styles.drawerTitle}>Speech Model</Text>
        {setup ? (
          <VoiceModelList
            setup={setup}
            disabled={false}
            busyAction={busyAction}
            onUseModel={(m) => void handleUseModel(m)}
            onDownload={(m) => void handleDownload(m)}
            onDelete={(m) => void handleDelete(m)}
          />
        ) : null}
      </BottomDrawer>
    </View>
  )
}
