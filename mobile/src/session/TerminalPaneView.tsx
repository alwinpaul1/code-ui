import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { TerminalWebView } from '../terminal/TerminalWebView'
import { useTheme } from '../theme/theme-context'
import type {
  MobileTerminalTheme,
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes,
  TerminalWebViewHandle
} from '../terminal/terminal-webview-contract'

type TerminalPaneViewProps = {
  handle: string
  active: boolean
  /** The pane holds its first kept frame (terminal-first-frame-reveal.ts). */
  revealed: boolean
  keyboardLift: number
  terminalTheme?: MobileTerminalTheme
  textScale: number
  onRef: (handle: string, ref: TerminalWebViewHandle | null) => void
  onWebReady: (handle: string) => void
  /** The WebView drew its error overlay; the cover must not hide it. */
  onEngineError: (handle: string) => void
  onSelectionMode: (handle: string, active: boolean) => void
  onSelectionCopy: (handle: string, text: string) => void
  onSelectionEvicted: (handle: string) => void
  onModesChanged: (handle: string, modes: TerminalModes) => void
  onKeyboardAvoidanceMetrics: (handle: string, metrics: TerminalKeyboardAvoidanceMetrics) => void
  onHaptic: (kind: 'selection' | 'success' | 'error' | 'edge-bump') => void
  onTerminalInput: (handle: string, bytes: string) => void
  onTerminalQueryReply: (handle: string, bytes: string) => void
  onTerminalTap: (handle: string) => void
  onFileTap: (handle: string, pathText: string, line: number | null, column: number | null) => void
  onOpenUrl: (handle: string, url: string) => void
  onTextScaleChange: (scale: number) => void
}

export function TerminalPaneView({
  handle,
  active,
  revealed,
  keyboardLift,
  terminalTheme,
  textScale,
  onRef,
  onWebReady,
  onEngineError,
  onSelectionMode,
  onSelectionCopy,
  onSelectionEvicted,
  onModesChanged,
  onKeyboardAvoidanceMetrics,
  onHaptic,
  onTerminalInput,
  onTerminalQueryReply,
  onTerminalTap,
  onFileTap,
  onOpenUrl,
  onTextScaleChange
}: TerminalPaneViewProps) {
  const { colors } = useTheme()
  const setRef = useCallback(
    (ref: TerminalWebViewHandle | null) => {
      onRef(handle, ref)
    },
    [handle, onRef]
  )

  return (
    <View
      // Why: inactive terminal WebViews stay mounted to preserve xterm state,
      // while touch and visibility are disabled until the tab is active again.
      pointerEvents={active ? 'auto' : 'none'}
      // Why: the pane keeps the WebView and its cover as its own native subviews in every state.
      // Without this, only an inactive (opacity 0) or lifted (translateY) pane formed a stacking
      // context on Android, so each tab switch and keyboard lift moved the terminal's views between
      // the pane and the terminal frame that also holds the chat (chat-ground-not-under-terminal.test.tsx).
      collapsable={false}
      style={[
        styles.terminalPane,
        keyboardLift > 0 && { transform: [{ translateY: -keyboardLift }] },
        !active && styles.terminalPaneHidden
      ]}
    >
      <TerminalWebView
        ref={setRef}
        style={styles.terminalWebView}
        terminalTheme={terminalTheme}
        textScale={textScale}
        onWebReady={() => onWebReady(handle)}
        onEngineError={() => onEngineError(handle)}
        onSelectionMode={(a) => onSelectionMode(handle, a)}
        onSelectionCopy={(t) => onSelectionCopy(handle, t)}
        onSelectionEvicted={() => onSelectionEvicted(handle)}
        onModesChanged={(m) => onModesChanged(handle, m)}
        onKeyboardAvoidanceMetrics={(m) => onKeyboardAvoidanceMetrics(handle, m)}
        onHaptic={onHaptic}
        onTerminalInput={(bytes) => onTerminalInput(handle, bytes)}
        onTerminalQueryReply={(bytes) => onTerminalQueryReply(handle, bytes)}
        onTerminalTap={() => onTerminalTap(handle)}
        onFileTap={(pathText, line, column) => onFileTap(handle, pathText, line, column)}
        onOpenUrl={(url) => onOpenUrl(handle, url)}
        onTextScaleChange={onTextScaleChange}
      />
      {/* Why: until the first kept frame the WebView shows its blank background
          or a frame about to be replaced; the session canvas covers it so the
          body goes from empty straight to the terminal. Drawn after the WebView
          so source order puts it on top, and over it rather than fading the
          WebView, which would stop the frames its init waits on. */}
      {!revealed && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  terminalPane: {
    ...StyleSheet.absoluteFill
  },
  terminalPaneHidden: {
    opacity: 0
  },
  terminalWebView: {
    flex: 1
  }
})
