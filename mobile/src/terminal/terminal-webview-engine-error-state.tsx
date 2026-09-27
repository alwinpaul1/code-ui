import { useCallback, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { RefreshCw } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { darkColors } from '../theme/tokens'

// This overlay paints over the terminal WebView, which stays Tokyonight-dark in both app themes
// (BRIEF: terminal content stays terminal-coloured, not app chrome). Its colours are pinned to the
// dark palette rather than the live theme, so a light-mode phone still gets legible text on the
// terminal's fixed dark background instead of near-black-on-near-black.

export type NativeWebViewEngineEvent = {
  readonly nativeEvent?: object
}

type TerminalWebViewEngineErrorOverlayProps = {
  readonly message: string
  readonly onReload: () => void
}

type NativeWebViewEngineFields = {
  readonly description?: unknown
  readonly code?: unknown
  readonly statusCode?: unknown
  readonly domain?: unknown
  readonly didCrash?: unknown
}

export function useTerminalWebViewEngineErrorState(onEngineError?: (message: string) => void) {
  const [engineError, setEngineError] = useState<string | null>(null)
  const clearEngineError = useCallback(() => setEngineError(null), [])
  const reportEngineError = useCallback(
    (message: string, fatal: boolean) => {
      onEngineError?.(message)
      // eslint-disable-next-line no-console
      console.warn('[terminal-webview] engine error', message)
      if (fatal) {
        // Why: the first fatal report is the root cause; later cascades (e.g. the
        // web-ready watchdog firing after a process-crash report) must not
        // overwrite its more specific diagnostics. clearEngineError resets.
        setEngineError((previous) => previous ?? message)
      }
    },
    [onEngineError]
  )
  const reportNativeEngineError = useCallback(
    (context: string, event?: NativeWebViewEngineEvent) => {
      reportEngineError(describeNativeWebViewEngineError(context, event), true)
    },
    [reportEngineError]
  )
  return { clearEngineError, engineError, reportEngineError, reportNativeEngineError }
}

export function describeNativeWebViewEngineError(
  context: string,
  event?: NativeWebViewEngineEvent
): string {
  const native = event?.nativeEvent as NativeWebViewEngineFields | undefined
  const parts = [context]
  const description = native?.description
  const statusCode = native?.statusCode
  const code = native?.code
  const domain = native?.domain
  if (typeof description === 'string') {
    parts.push(description)
  }
  if (typeof statusCode === 'number') {
    parts.push(`status ${statusCode}`)
  }
  if (typeof code === 'number') {
    parts.push(`code ${code}`)
  }
  if (typeof domain === 'string') {
    parts.push(domain)
  }
  if (native?.didCrash === true) {
    parts.push('renderer crashed')
  }
  return parts.join(' - ')
}

export function TerminalWebViewEngineErrorOverlay({
  message,
  onReload
}: TerminalWebViewEngineErrorOverlayProps) {
  return (
    <View style={styles.errorOverlay}>
      <Text style={styles.errorTitle}>Terminal failed to load</Text>
      <Text style={styles.errorDetail} numberOfLines={4}>
        {message}
      </Text>
      <Pressable
        hitSlop={tapTargetHitSlop(styles.reloadButton)}
        accessibilityRole="button"
        style={styles.reloadButton}
        onPress={onReload}
      >
        <RefreshCw size={16} color={darkColors.textInverse} />
        <Text style={styles.reloadButtonText}>Reload</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: darkColors.terminalBg
  },
  errorTitle: {
    color: darkColors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center'
  },
  errorDetail: {
    color: darkColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center'
  },
  reloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 6,
    // Was `surfaceBright`: the near-white inverse-surface fill for a primary action, same pairing
    // as `text` + `textInverse` elsewhere in the sweep.
    backgroundColor: darkColors.text
  },
  reloadButtonText: {
    color: darkColors.textInverse,
    fontSize: 14,
    fontWeight: '700'
  }
})
