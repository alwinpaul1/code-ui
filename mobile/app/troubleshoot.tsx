import { useState, useCallback, useRef } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  ScrollText,
  XCircle,
  AlertTriangle
} from 'lucide-react-native'
import { spacing } from '../src/theme/mobile-theme'
import { useTheme } from '../src/theme/theme-context'
import { useRpcClientContext } from '../src/transport/client-context'
import { loadHostCatalog } from '../src/transport/host-store'
import { readMobileLocalAddress, readMobileNetworkType } from '../src/transport/mobile-network-type'
import {
  startDiagnosticFetchTimeout,
  type DiagnosticFetchTimeout
} from '../src/diagnostics/diagnostic-fetch-timeout'
import { testHostReachability } from '../src/diagnostics/host-reachability'
import { phoneVpnNativeModule } from '../src/diagnostics/phone-vpn-native'
import { readPhoneVpnStatus } from '../src/diagnostics/phone-vpn-status'
import {
  phoneOnWifiFromNetworkType,
  readHostLiveConnection,
  troubleshootHostCheck,
  type TroubleshootCheck
} from '../src/diagnostics/troubleshoot-host-check'
import { troubleshootCommonIssues } from '../src/diagnostics/troubleshoot-common-issues'
import {
  PAIRED_HOSTS_UNREADABLE_CHECK,
  troubleshootHostTarget,
  troubleshootPairedHostsCheck
} from '../src/diagnostics/troubleshoot-paired-hosts'
import { useTroubleshootScreenStyles } from '../src/diagnostics/troubleshoot-screen-styles'
import { MobileWebBundleProbeRow } from '../src/diagnostics/mobile-web-bundle-probe-row'
import { MobileWebShellDevRow } from '../src/diagnostics/mobile-web-shell-dev-row'
import { MobileWebShellUpdateFailureRow } from '../src/diagnostics/mobile-web-shell-update-failure-row'
import { mobileWebShellFlagCanBeOn } from '../src/storage/preferences'

// Same guard as mobile-terminal-diagnostics.ts: `__DEV__` is undefined outside the React Native runtime. The import
// above is static, so a release bundle still carries the row's graph and evaluates its hoisted
// schemas at load; nothing mounts, no host is looked up and no request is made. This repo has no
// `__DEV__`-conditional `require` idiom to trim it with — every `require` in `mobile/src` is a Metro
// asset path — so introducing one is a change for the shell in Phase B, not for this row.
// (Code UI keeps the whole screen in this route rather than upstream's TroubleshootView, so the
// `developerRow` slot upstream added there is this one expression below the network button.)
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

type DiagnosticStatus = 'idle' | 'running' | 'done'

type CheckResult = TroubleshootCheck

function StatusIcon({ status }: { status: CheckResult['status'] }) {
  const { colors } = useTheme()
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={14} color={colors.success} />
    case 'fail':
      return <XCircle size={14} color={colors.danger} />
    case 'warn':
      return <AlertTriangle size={14} color={colors.warning} />
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

export default function TroubleshootScreen() {
  const styles = useTroubleshootScreenStyles()
  const { colors } = useTheme()
  const clientContext = useRpcClientContext()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [diagnosticStatus, setDiagnosticStatus] = useState<DiagnosticStatus>('idle')
  const [checks, setChecks] = useState<CheckResult[]>([])
  const abortRef = useRef(false)
  const diagnosticRunRef = useRef(0)
  const activeInternetCheckRef = useRef<DiagnosticFetchTimeout | null>(null)

  const setTroubleshootRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      return
    }
    // Why: diagnostics can outlive the screen; cancel the active run when the
    // route detaches without a passive cleanup-only Effect.
    abortRef.current = true
    diagnosticRunRef.current += 1
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
  }, [])

  const toggleSection = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const runDiagnostics = useCallback(async () => {
    const runId = diagnosticRunRef.current + 1
    diagnosticRunRef.current = runId
    abortRef.current = false
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
    setDiagnosticStatus('running')
    setChecks([])

    const results: CheckResult[] = []
    const isCurrentRun = () => !abortRef.current && diagnosticRunRef.current === runId

    try {
      results.push(troubleshootPairedHostsCheck(await loadHostCatalog()))
    } catch {
      results.push(PAIRED_HOSTS_UNREADABLE_CHECK)
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    const internetCheck = startDiagnosticFetchTimeout(5000)
    activeInternetCheckRef.current = internetCheck
    try {
      const resp = await fetch('https://dns.google/resolve?name=example.com&type=A', {
        signal: internetCheck.signal
      })
      if (!isCurrentRun()) {
        return
      }
      results.push(
        resp.ok
          ? { label: 'Internet', status: 'pass', detail: 'Connected' }
          : { label: 'Internet', status: 'warn', detail: 'Unexpected response' }
      )
    } catch {
      if (!isCurrentRun()) {
        return
      }
      results.push({ label: 'Internet', status: 'fail', detail: 'No connection' })
    } finally {
      internetCheck.dispose()
      if (activeInternetCheckRef.current === internetCheck) {
        activeInternetCheckRef.current = null
      }
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    try {
      const [catalog, localAddress, networkType] = await Promise.all([
        loadHostCatalog(),
        readMobileLocalAddress(),
        readMobileNetworkType()
      ])
      for (const entry of catalog) {
        if (!isCurrentRun()) {
          return
        }
        const target = troubleshootHostTarget(entry)
        if (target.kind === 'check') {
          results.push(target.check)
          setChecks([...results])
          continue
        }
        const host = target.host
        // The probe dials the saved direct endpoint only; the VPN check needs that address too.
        const [reachable, phoneVpn] = await Promise.all([
          testHostReachability(host.endpoint),
          readPhoneVpnStatus(host.endpoint, phoneVpnNativeModule())
        ])
        if (!isCurrentRun()) {
          return
        }
        // Read after the probe, so the row judges the connection as it stands when it is drawn.
        results.push(
          troubleshootHostCheck({
            host,
            reachable,
            live: readHostLiveConnection(clientContext, host.id),
            localAddress,
            phoneOnWifi: phoneOnWifiFromNetworkType(networkType),
            phoneVpn
          })
        )
        setChecks([...results])
      }
    } catch {
      results.push({ label: 'Hosts', status: 'warn', detail: 'Could not test' })
    }

    if (!isCurrentRun()) {
      return
    }

    results.push({
      label: 'Platform',
      status: 'pass',
      detail: `${Platform.OS} ${Platform.Version ?? ''}`
    })

    setChecks([...results])
    setDiagnosticStatus('done')
  }, [clientContext])

  return (
    <View
      ref={setTroubleshootRootRef}
      style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Troubleshooting</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed,
            diagnosticStatus === 'running' && styles.diagnosticButtonDisabled
          ]}
          onPress={runDiagnostics}
          disabled={diagnosticStatus === 'running'}
        >
          {diagnosticStatus === 'running' ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Activity size={16} color={colors.text} />
          )}
          <Text style={styles.diagnosticButtonLabel}>
            {diagnosticStatus === 'running'
              ? 'Running…'
              : diagnosticStatus === 'done'
                ? 'Run again'
                : 'Run diagnostics'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed
          ]}
          onPress={() => router.push('/connection-log')}
        >
          <ScrollText size={16} color={colors.text} />
          <Text style={styles.diagnosticButtonLabel}>View network diagnostics</Text>
        </Pressable>

        {mobileWebShellFlagCanBeOn() ? (
          <>
            {/* The shell rows wherever the flag can be on, which in an OTA build is the only way
                back to the native screens and the only place its update failures show. The
                bundle probe stays development-only: it fetches. */}
            {isDevelopmentBuild ? <MobileWebBundleProbeRow /> : null}
            <MobileWebShellDevRow />
            <MobileWebShellUpdateFailureRow />
          </>
        ) : null}

        {checks.length > 0 && (
          <View style={styles.section}>
            {checks.map((check, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.checkRow}>
                  <StatusIcon status={check.status} />
                  <Text style={styles.checkLabel}>{check.label}</Text>
                  <Text
                    style={[styles.checkDetail, check.status === 'fail' && styles.checkDetailFail]}
                  >
                    {check.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>Common issues</Text>

        <View style={styles.section}>
          {troubleshootCommonIssues.map((section, i) => (
            <View key={section.id}>
              {i > 0 && <View style={styles.separator} />}
              <Pressable
                style={({ pressed }) => [styles.accordionHeader, pressed && styles.rowPressed]}
                onPress={() => toggleSection(section.id)}
              >
                <section.Icon size={16} color={colors.textSecondary} />
                <Text style={styles.accordionTitle}>{section.title}</Text>
                {expandedId === section.id ? (
                  <ChevronUp size={16} color={colors.textMuted} />
                ) : (
                  <ChevronDown size={16} color={colors.textMuted} />
                )}
              </Pressable>
              {expandedId === section.id && (
                <View style={styles.accordionBody}>
                  {section.steps.map((step, j) => (
                    <View key={j} style={styles.stepRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  )
}
