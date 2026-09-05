import { useState, useRef, useCallback } from 'react'
import { View, ActivityIndicator, Linking, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { Clipboard as ClipboardIcon, QrCode } from 'lucide-react-native'
import { decodePairingUrl, parsePairingCode } from '../src/transport/pairing'
import {
  startPreProfilePairing,
  type PreProfilePairingAttempt
} from '../src/transport/pre-profile-pairing-coordinator'
import type { ConnectionLogEntry, PairingOffer } from '../src/transport/types'
import { useRefreshHostClient } from '../src/transport/client-context'
import { useTheme } from '../src/theme/theme-context'
import { Button } from '../src/ui/Button'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import { TextInputModal } from '../src/components/TextInputModal'
import { ConnectionLog } from '../src/components/ConnectionLog'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../src/onboarding/mobile-onboarding-plan'

// Why: see pair-confirm.tsx — cap initial-pair "Connecting…" so a broken
// route surfaces as a real error with the log visible instead of a
// silent infinite spinner.
const PAIRING_OVERALL_TIMEOUT_MS = 25_000
const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

function Step({ number, text }: { number: number; text: string }) {
  const { colors, space } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Txt variant="caption" weight="bold" tone="accent">
          {number}
        </Txt>
      </View>
      <Txt variant="body" tone="secondary">
        {text}
      </Txt>
    </View>
  )
}

function ReticleCorner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const edge = {
    tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
    tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
    bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
    br: {
      bottom: 0,
      right: 0,
      borderBottomWidth: 3,
      borderRightWidth: 3,
      borderBottomRightRadius: 8
    }
  }[position]
  return (
    <View
      style={[
        { position: 'absolute', width: 30, height: 30, borderColor: 'rgba(255,255,255,0.85)' },
        edge
      ]}
    />
  )
}

export default function PairScanScreen() {
  const router = useRouter()
  const refreshHostClient = useRefreshHostClient()
  const insets = useSafeAreaInsets()
  const { colors, radius, space } = useTheme()
  const [permission, requestPermission] = useCameraPermissions()
  const [status, setStatus] = useState<'scanning' | 'connecting' | 'error'>('scanning')
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const activePairingAttemptRef = useRef<PreProfilePairingAttempt | null>(null)

  const setPairScanRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    // Why: pairing attempts can outlive the visible route; dispose them when
    // the scan screen detaches without a passive cleanup-only Effect.
    mountedRef.current = false
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
  }, [])

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (processingRef.current) {
      return
    }
    processingRef.current = true

    const offer = decodePairingUrl(data)
    if (!offer) {
      setStatus('error')
      setErrorMessage('Not a valid pairing QR code')
      processingRef.current = false
      return
    }

    void testAndSave(offer)
  }, [])

  const handlePasteSubmit = useCallback((input: string) => {
    setPasteVisible(false)
    if (processingRef.current) {
      return
    }
    processingRef.current = true

    const offer = parsePairingCode(input)
    if (!offer) {
      setStatus('error')
      setErrorMessage('Not a valid pairing code — copy it from your computer and paste again')
      processingRef.current = false
      return
    }

    void testAndSave(offer)
  }, [])

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const nextBounds = {
      width: Math.round(width),
      height: Math.round(height)
    }
    setCameraBounds((currentBounds) =>
      currentBounds.width === nextBounds.width && currentBounds.height === nextBounds.height
        ? currentBounds
        : nextBounds
    )
  }, [])

  async function testAndSave(offer: PairingOffer) {
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
      console.warn('[pair] connect failed', err)
      setStatus('error')
      setErrorMessage(
        timedOut
          ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s — see the log below for where it stalled`
          : `Pairing failed: ${err instanceof Error ? err.message : String(err)}`
      )
      processingRef.current = false
    }
  }

  function retry() {
    setStatus('scanning')
    setErrorMessage('')
    logsRef.current = []
    setLogs([])
    processingRef.current = false
  }

  // Why: iPad camera previews are often rectangular, but QR guides should
  // stay square so the corners still describe the code shape.
  const reticleSize = Math.min(
    Math.round(Math.min(cameraBounds.width, cameraBounds.height) * SCAN_RETICLE_SCALE),
    SCAN_RETICLE_MAX_SIZE
  )

  const pasteModal = (
    <TextInputModal
      visible={pasteVisible}
      title="Paste pairing code"
      message="Copy the code shown under the QR on your computer."
      placeholder="orca://pair?code=… or the code itself"
      onSubmit={handlePasteSubmit}
      onCancel={() => setPasteVisible(false)}
    />
  )

  const container = { flex: 1, backgroundColor: colors.bg }
  // Why: bottom inset accounts for Android 3-button nav bars and iOS
  // home-indicator areas that would otherwise overlap the bottom button.
  const bodyPadding = {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingBottom: insets.bottom + space.md
  }

  if (!permission) {
    return (
      <View ref={setPairScanRootRef} style={[container, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false
    return (
      <View ref={setPairScanRootRef} style={container}>
        <ScreenHeader title="Pair desktop" onBack={() => router.back()} />
        <View style={[bodyPadding, { alignItems: 'center', justifyContent: 'center', gap: space.md }]}>
          <QrCode size={40} color={colors.accent} strokeWidth={1.8} />
          <Txt variant="title" weight="semibold" align="center">
            {canAskAgain ? 'Scan to pair' : 'Camera access is off'}
          </Txt>
          <Txt variant="body" tone="secondary" align="center" style={{ maxWidth: 320 }}>
            {canAskAgain
              ? 'Scan the QR code from Orca on your desktop, or paste the pairing code instead.'
              : 'Enable camera access in Settings, or paste the pairing code instead.'}
          </Txt>
          <Button
            label={canAskAgain ? 'Allow camera' : 'Open Settings'}
            icon={canAskAgain ? QrCode : undefined}
            variant="accent"
            size="lg"
            onPress={canAskAgain ? () => void requestPermission() : () => void Linking.openSettings()}
          />
          <Button
            label="Paste code instead"
            icon={ClipboardIcon}
            variant="ghost"
            onPress={() => setPasteVisible(true)}
          />
        </View>
        {pasteModal}
      </View>
    )
  }

  return (
    <View ref={setPairScanRootRef} style={container}>
      <ScreenHeader title="Pair desktop" onBack={() => router.back()} />
      <View style={bodyPadding}>
        <View style={{ gap: space.sm + 2, marginBottom: space.lg, marginTop: space.xs }}>
          <Step number={1} text="Open Orca on your computer" />
          <Step number={2} text="Go to Settings → Mobile" />
          <Step number={3} text="Scan the QR code" />
        </View>

        {status === 'scanning' && (
          <>
            {/* Why: unmount the camera while the paste sheet is open. The user
                has chosen the paste path; a camera streaming behind a sheet
                wastes power and could scan a QR silently in the meantime. */}
            {!pasteVisible ? (
              <View
                style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden' }}
                onLayout={handleCameraLayout}
              >
                <CameraView
                  style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  pointerEvents="none"
                >
                  <View style={{ position: 'relative', width: reticleSize, height: reticleSize }}>
                    <ReticleCorner position="tl" />
                    <ReticleCorner position="tr" />
                    <ReticleCorner position="bl" />
                    <ReticleCorner position="br" />
                  </View>
                </View>
              </View>
            ) : (
              <Surface level="raised" rounded="xl" style={{ flex: 1 }} bordered={false} />
            )}
            <Button
              label="Or paste the pairing code"
              icon={ClipboardIcon}
              variant="ghost"
              block
              style={{ marginTop: space.md }}
              onPress={() => setPasteVisible(true)}
            />
          </>
        )}

        {status === 'connecting' && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Txt variant="body" tone="secondary">
              Connecting…
            </Txt>
            <View style={{ width: '100%' }}>
              <ConnectionLog entries={logs} title="Pairing log" />
            </View>
          </View>
        )}

        {status === 'error' && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
            <Txt variant="body" tone="danger" align="center">
              {errorMessage}
            </Txt>
            {logs.length > 0 && (
              <View style={{ width: '100%' }}>
                <ConnectionLog entries={logs} title="Pairing log" />
              </View>
            )}
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <Button label="Try again" variant="primary" onPress={retry} />
              <Button
                label="Paste code instead"
                variant="ghost"
                onPress={() => {
                  retry()
                  setPasteVisible(true)
                }}
              />
            </View>
          </View>
        )}
      </View>
      {pasteModal}
    </View>
  )
}
