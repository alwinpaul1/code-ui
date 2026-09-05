import { useCallback, useRef, useState } from 'react'
import { View, ActivityIndicator, BackHandler } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { resolvePairConfirmRouteState } from '../src/transport/pair-confirm-state'
import {
  startPreProfilePairing,
  type PreProfilePairingAttempt
} from '../src/transport/pre-profile-pairing-coordinator'
import type { ConnectionLogEntry } from '../src/transport/types'
import { useRefreshHostClient } from '../src/transport/client-context'
import { useTheme } from '../src/theme/theme-context'
import { Button } from '../src/ui/Button'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { Txt } from '../src/ui/Txt'
import { OrcaLogo } from '../src/components/OrcaLogo'
import { ConnectionLog } from '../src/components/ConnectionLog'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../src/onboarding/mobile-onboarding-plan'

type Status = 'awaiting-confirm' | 'connecting' | 'error'

// Why: cap how long the user stares at "Connecting…" during pairing.
// rpc-client retries forever by design (good for live sessions), but for
// the *initial* pair we want a hard ceiling so a half-broken Tailscale
// route surfaces an actionable error with the log visible, instead of
// spinning silently. ~25s allows for one full connect-timeout + a retry.
const PAIRING_OVERALL_TIMEOUT_MS = 25_000

export default function PairConfirmScreen() {
  const router = useRouter()
  const refreshHostClient = useRefreshHostClient()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()
  const params = useLocalSearchParams<{ code?: string }>()
  const [status, setStatus] = useState<Status>('awaiting-confirm')
  const [errorMessage, setErrorMessage] = useState('')
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  // Why: collect logs in a ref so the rpc-client callback (which closures
  // over the initial state setter) always sees the freshest list and we
  // batch fewer setState calls when entries arrive in bursts.
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const mountedRef = useRef(true)
  const activePairingAttemptRef = useRef<PreProfilePairingAttempt | null>(null)

  const routeState = resolvePairConfirmRouteState(params.code)
  const offer = routeState.offer
  const resolvedStatus =
    status === 'awaiting-confirm' && routeState.kind === 'error' ? 'error' : status
  const resolvedErrorMessage =
    status === 'awaiting-confirm' && routeState.kind === 'error'
      ? routeState.errorMessage
      : errorMessage

  const cancel = useCallback(() => {
    router.replace('/')
  }, [router])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        cancel()
        return true
      })
      return () => subscription.remove()
    }, [cancel])
  )

  const setPairConfirmRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    // Why: pairing attempts can outlive the visible route; dispose them when
    // the confirm screen detaches without a passive cleanup-only Effect.
    mountedRef.current = false
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
  }, [])

  async function confirm() {
    if (!offer) {
      return
    }
    setStatus('connecting')
    logsRef.current = []
    setLogs([])
    activePairingAttemptRef.current?.dispose()

    const attempt = startPreProfilePairing({
      offer,
      timeoutMs: PAIRING_OVERALL_TIMEOUT_MS,
      connectOptions: {
        onLog: (entry) => {
          if (!mountedRef.current || activePairingAttemptRef.current !== attempt) {
            return
          }
          logsRef.current = [...logsRef.current, entry]
          setLogs(logsRef.current)
        }
      }
    })
    activePairingAttemptRef.current = attempt
    try {
      const { hostId } = await attempt.result
      const attemptIsCurrent = activePairingAttemptRef.current === attempt
      attempt.dispose()
      if (activePairingAttemptRef.current === attempt) {
        activePairingAttemptRef.current = null
      }
      if (!mountedRef.current || !attemptIsCurrent) {
        return
      }
      // Why: re-pairing the same desktop reuses its existing host id (STA-1840
      // dedup), so a client cached under that id from an earlier pairing would
      // keep the stale endpoint/relay. Refresh it from the new profile.
      refreshHostClient(hostId)
      const onboardingSteps = await loadMobileOnboardingSteps()
      if (!mountedRef.current) {
        return
      }
      router.replace(mobileOnboardingDestination(onboardingSteps, hostId))
    } catch (err) {
      const timedOut = attempt.timedOut
      const attemptIsCurrent = activePairingAttemptRef.current === attempt
      attempt.dispose()
      if (activePairingAttemptRef.current === attempt) {
        activePairingAttemptRef.current = null
      }
      if (!mountedRef.current || !attemptIsCurrent) {
        return
      }
      console.warn('[pair-confirm] connect failed', err)
      setStatus('error')
      setErrorMessage(
        timedOut
          ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s — see the log below for where it stalled`
          : `Pairing failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return (
    <View ref={setPairConfirmRootRef} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Pair desktop" onBack={cancel} backLabel="Cancel pairing" />
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: space.xl,
          // Why: nudge the group above the geometric middle so the eye reads it
          // as centered above the home indicator / nav bar.
          paddingBottom: insets.bottom + space.xxl * 2,
          gap: space.lg
        }}
      >
        {offer && resolvedStatus === 'awaiting-confirm' && (
          <>
            <OrcaLogo size={40} />
            <Txt variant="title" weight="semibold" align="center">
              Pair with this desktop?
            </Txt>
            <Txt variant="body" tone="secondary" align="center" style={{ maxWidth: 360 }}>
              You opened a pairing link from your desktop. Confirm to add it to your hosts.
            </Txt>
            <View style={{ width: '100%', maxWidth: 360, gap: space.sm, marginTop: space.sm }}>
              <Button label="Pair" variant="accent" size="lg" block onPress={() => void confirm()} />
              <Button label="Cancel" variant="ghost" block onPress={cancel} />
            </View>
          </>
        )}

        {resolvedStatus === 'connecting' && (
          <>
            <ActivityIndicator size="large" color={colors.accent} />
            <Txt variant="body" tone="secondary" align="center">
              Connecting…
            </Txt>
            <View style={{ width: '100%' }}>
              <ConnectionLog entries={logs} title="Pairing log" />
            </View>
          </>
        )}

        {resolvedStatus === 'error' && (
          <>
            <Txt variant="body" tone="danger" align="center">
              {resolvedErrorMessage}
            </Txt>
            {logs.length > 0 && (
              <View style={{ width: '100%' }}>
                <ConnectionLog entries={logs} title="Pairing log" />
              </View>
            )}
            <Button label="Back to home" variant="primary" onPress={cancel} />
          </>
        )}
      </View>
    </View>
  )
}
