import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { tapTargetHitSlop } from '../src/ui/tap-target'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { ChevronLeft, Copy, Check } from 'lucide-react-native'
import { spacing, typography } from '../src/theme/mobile-theme'
import { useTheme, useThemedStyles, type Theme } from '../src/theme/theme-context'
import { emptyHostsNoticeCopy, useLoadedHosts } from '../src/transport/use-loaded-hosts'
import { connectionLogStore } from '../src/transport/persisted-connection-log-store'
import { useHostClient, useRpcClientContext } from '../src/transport/client-context'
import {
  useConnectionPathStatus,
  useLastConnectedAt,
  useReconnectAttempt
} from '../src/transport/client-context-connection-metrics'
import { buildConnectionDiagnosticsReport } from '../src/diagnostics/connection-diagnostics-report'
import {
  backgroundDeliveryState,
  isBackgroundDeliveryAvailable
} from '../src/background/background-link'
import { diagnoseConnection } from '../src/diagnostics/connection-diagnostics-analysis'
import { describeAppPauses } from '../src/diagnostics/connection-diagnostics-pauses'
import {
  buildConnectionTimeline,
  liveConnectionRow
} from '../src/diagnostics/connection-diagnostics-timeline'
import { ConnectionDiagnosticsTimeline } from '../src/diagnostics/connection-diagnostics-timeline-view'
import { phoneVpnNativeModule } from '../src/diagnostics/phone-vpn-native'
import { readPhoneVpnStatus } from '../src/diagnostics/phone-vpn-status'
import {
  readHydratedConnectionLog,
  readConnectionDiagnosticsSnapshot,
  resolveDiagnosticsHostId,
  type DiagnosticsHostSelection,
  type DiagnosticsRouteKey
} from '../src/diagnostics/connection-diagnostics-screen-data'
import { useHostStatusGates } from '../src/transport/host-status-gates'
import { loadHostAppVersion } from '../src/transport/host-app-version-store'
import { useNow } from '../src/hooks/use-now'
import { useClipboardWriter } from '../src/platform/clipboard'
import type { ConnectionLogEntry } from '../src/transport/types'

// Why: getSnapshot must be referentially stable when there's no data —
// a fresh [] per call would make useSyncExternalStore re-render forever.
const EMPTY_ENTRIES: readonly ConnectionLogEntry[] = []

// Why: reading the log is most needed while a host is failing, so this
// screen also *acquires* the host client — opening it kicks a dial and the
// log fills live instead of showing a stale tail.
export default function ConnectionLogScreen() {
  const styles = useThemedStyles(connectionLogScreenStyles)
  const { colors } = useTheme()
  const clientContext = useRpcClientContext()
  const router = useRouter()
  const params = useLocalSearchParams<{ hostId?: string }>()
  const insets = useSafeAreaInsets()
  const routeKey = useMemo((): DiagnosticsRouteKey => ({}), [params.hostId])
  const loadedHosts = useLoadedHosts()
  const { hosts, loaded: hostsLoaded } = loadedHosts
  const [manualSelection, setManualSelection] = useState<DiagnosticsHostSelection | null>(null)
  const [copiedHostId, setCopiedHostId] = useState<string | null>(null)
  // Why a copy did not land, for the host it was pressed on; cleared by the next press.
  const [copyFailure, setCopyFailure] = useState<{ hostId: string; cause: string } | null>(null)
  const clipboard = useClipboardWriter()

  const selectedId = resolveDiagnosticsHostId(hosts, params.hostId, manualSelection, routeKey)
  const selected = hosts.find((h) => h.id === selectedId) ?? null
  const { client, state } = useHostClient(selected?.id)
  const { desktopAppVersion: liveDesktopAppVersion } = useHostStatusGates({
    hostId: selected?.id,
    client,
    connState: state
  })
  const reconnectAttempts = useReconnectAttempt(selected?.id)
  const { activePath, pendingPath } = useConnectionPathStatus(selected?.id)
  const lastConnectedAt = useLastConnectedAt(selected?.id)
  // "Of the last N hours" ends now; a minute's tick keeps it honest while the screen stays open.
  const now = useNow(60_000)

  useEffect(() => {
    if (selectedId) {
      void readHydratedConnectionLog(connectionLogStore, selectedId)
    }
  }, [selectedId])

  const subscribe = useCallback(
    (listener: () => void) =>
      selectedId ? connectionLogStore.subscribe(selectedId, listener) : () => {},
    [selectedId]
  )
  const getSnapshot = useCallback(
    () => (selectedId ? connectionLogStore.get(selectedId) : EMPTY_ENTRIES),
    [selectedId]
  )
  const entries = useSyncExternalStore(subscribe, getSnapshot)
  const diagnosis = selected
    ? diagnoseConnection({ endpoint: selected.endpoint, state, activePath, pendingPath, entries })
    : null
  // Said even while connected: a connected state says nothing about the hours Android kept the
  // app frozen (2026-09-27).
  const pauses = selected ? describeAppPauses(entries, now) : null
  const live = liveConnectionRow({ state, activePath, lastConnectedAt, entries, nowMs: now })
  const timeline = useMemo(() => buildConnectionTimeline(entries), [entries])
  const copied = copiedHostId === selectedId
  const copyFailureCause = copyFailure?.hostId === selectedId ? copyFailure.cause : null

  const buildReport = useCallback(
    async (host: NonNullable<typeof selected>): Promise<string> => {
      const desktopAppVersion = liveDesktopAppVersion ?? (await loadHostAppVersion(host.id))
      const [snapshot, phoneVpn] = await Promise.all([
        readConnectionDiagnosticsSnapshot(clientContext, connectionLogStore, host.id),
        readPhoneVpnStatus(host.endpoint, phoneVpnNativeModule())
      ])
      return buildConnectionDiagnosticsReport({
        hostName: host.name,
        endpoint: host.endpoint,
        state: snapshot.state,
        reconnectAttempts: snapshot.reconnectAttempts,
        lastConnectedAt: snapshot.lastConnectedAt,
        platform: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        desktopAppVersion,
        entries: snapshot.entries,
        activePath: snapshot.activePath,
        pendingPath: snapshot.pendingPath,
        background: isBackgroundDeliveryAvailable() ? backgroundDeliveryState() : null,
        phoneVpn
      })
    },
    [liveDesktopAppVersion, clientContext]
  )

  // Never rejects: the button fires it and forgets it. It said "Copied" over a write the
  // clipboard refused (setStringAsync's answer was ignored) and left a failed report build as an
  // unhandled rejection with nothing on screen, so the old clipboard went into a bug report
  // (review, 2026-09-30). The writer throws on a refusal, and any failure is shown and logged.
  const copyDiagnostics = useCallback(async () => {
    if (!selected) {
      return
    }
    setCopyFailure(null)
    try {
      await clipboard.writeText(await buildReport(selected))
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      console.warn(`[connection-log] Copy report failed: ${cause}`)
      setCopiedHostId(null)
      setCopyFailure({ hostId: selected.id, cause })
      return
    }
    setCopiedHostId(selected.id)
    setTimeout(() => setCopiedHostId((hostId) => (hostId === selected.id ? null : hostId)), 2000)
  }, [selected, clipboard, buildReport])

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
        <Text style={styles.heading}>Network diagnostics</Text>
      </View>

      {hosts.length > 1 && (
        <View style={styles.hostPicker}>
          {hosts.map((host) => (
            <Pressable
              key={host.id}
              style={[styles.hostChip, host.id === selectedId && styles.hostChipActive]}
              onPress={() =>
                setManualSelection({ hostId: host.id, requestedHostId: params.hostId, routeKey })
              }
            >
              <Text
                style={[styles.hostChipText, host.id === selectedId && styles.hostChipTextActive]}
                numberOfLines={1}
              >
                {host.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected ? (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              {state}
              {reconnectAttempts > 0 ? ` · attempt ${reconnectAttempts}` : ''}
            </Text>
            <Pressable style={styles.copyButton} onPress={() => void copyDiagnostics()}>
              {copied ? (
                <Check size={14} color={colors.success} />
              ) : (
                <Copy size={14} color={colors.textSecondary} />
              )}
              <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy report'}</Text>
            </Pressable>
          </View>
          {copyFailureCause !== null ? (
            <Text style={styles.copyFailure} accessibilityLiveRegion="polite">
              {`Couldn't copy the report: ${copyFailureCause.replace(/\.$/, '')}.`}
            </Text>
          ) : null}
          {diagnosis && (
            <View style={styles.diagnosisCard}>
              <Text style={styles.diagnosisHeading}>What this suggests</Text>
              <Text style={styles.diagnosisText}>{diagnosis.likelyCause}</Text>
              <Text style={styles.diagnosisNext}>{diagnosis.nextStep}</Text>
              {pauses !== null ? <Text style={styles.diagnosisPauses}>{pauses}</Text> : null}
            </View>
          )}
          {/* Keyed by host: another host's log starts with its folds closed and scrolled to its end. */}
          <ConnectionDiagnosticsTimeline
            key={selected.id}
            title={selected.name}
            live={live}
            rows={timeline}
          />
        </>
      ) : hostsLoaded ? (
        <Text style={styles.emptyText}>
          {emptyHostsNoticeCopy(loadedHosts, 'No paired hosts.')}
        </Text>
      ) : null}
    </View>
  )
}

/** From the live theme. The screen was one static sheet on the legacy dark palette, so it stayed
 *  dark in light mode (2026-09-27). Layout still reads the legacy spacing and type scale. */
function connectionLogScreenStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.lg
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.lg
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm
    },
    heading: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text
    },
    hostPicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md
    },
    hostChip: {
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: 16,
      backgroundColor: colors.bgRaised
    },
    hostChipActive: {
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    hostChipText: {
      fontSize: typography.metaSize,
      color: colors.textSecondary,
      maxWidth: 160
    },
    hostChipTextActive: {
      color: colors.text,
      fontWeight: '600'
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm
    },
    statusText: {
      fontSize: typography.metaSize,
      color: colors.textSecondary
    },
    diagnosisCard: {
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      padding: spacing.md,
      marginBottom: spacing.md
    },
    diagnosisHeading: {
      fontSize: typography.metaSize,
      fontWeight: '600',
      color: colors.text,
      marginBottom: spacing.xs
    },
    diagnosisText: {
      fontSize: typography.metaSize,
      color: colors.text,
      lineHeight: 18
    },
    diagnosisNext: {
      fontSize: typography.metaSize,
      color: colors.textSecondary,
      lineHeight: 18,
      marginTop: spacing.xs
    },
    diagnosisPauses: {
      fontSize: typography.metaSize,
      color: colors.text,
      lineHeight: 18,
      marginTop: spacing.xs
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: 8,
      backgroundColor: colors.bgRaised
    },
    copyButtonText: {
      fontSize: typography.metaSize,
      fontWeight: '600',
      color: colors.text
    },
    copyFailure: {
      fontSize: typography.metaSize,
      color: colors.danger,
      lineHeight: 18,
      marginBottom: spacing.sm
    },
    emptyText: {
      fontSize: typography.metaSize,
      color: colors.textMuted,
      lineHeight: 18
    }
  })
}
