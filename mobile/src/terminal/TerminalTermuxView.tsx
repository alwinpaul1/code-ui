import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  TermuxTerminalNativeView,
  type TermuxTerminalModesEvent,
  type TermuxTerminalNativeHandle
} from '@codeui/expo-termux-terminal'
import { termuxThemeFromMobileTheme } from './termux-terminal-theme'
import { findFileUrlAtColumn, findUrlAtColumn, resolveTerminalFileUrlTap } from './terminal-webview-url-tap'
import { TERMINAL_TEXT_SCALES } from '../storage/preferences'
import type { TerminalModes, TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { extractOnlyTerminalQueryReplies } from '../../../src/shared/terminal-query-reply'
import { createTerminalReplayGuard } from './terminal-replay-guard'

/** Termux's own default; 13 dp at scale 1, the size the earlier engines were measured at. */
const TERMUX_BASE_FONT_DP = 13

/** Keep the host-fit scaling inside a readable range. */
const MIN_FONT_DP = 4
const MAX_FONT_DP = 64

/**
 * A fresh grid before a snapshot is replayed, and what `clear` writes. Termux's RIS resets
 * modes and colours, erases the screen, drops the transcript and homes the cursor, but it stays
 * on the alternate screen when a program left it there, so that screen is left first.
 */
const RESET_SEQUENCE = '\u001b[?1049l\u001bc'

/**
 * Termux's terminal behind the handle the session drives every engine with, so nothing above
 * this file knows which engine it has. The view is com.termux.view vendored into
 * packages/expo-termux-terminal with its PTY-bound session replaced by one the relay feeds.
 *
 * Where the contract meets a native grid, the same way as the libghostty view before it:
 * - The grid is layout-driven. `init`/`resize`/`reflow` cannot set cols/rows; the view reports
 *   its own via onResize and the host fits the PTY to that. A host that keeps its own width
 *   gets the font scaled until the grid matches what it addresses.
 * - Writes go straight to the native parser; there is no bridge to coalesce for.
 * - Scroll is native: on a mouse-tracking program the view sends wheel reports through
 *   onInput; on the alternate screen without tracking it sends arrow keys, as Termux does;
 *   otherwise it scrolls its own transcript.
 * - Focus, the IME and the accessory row stay with React Native; the view never takes focus.
 */
export const TerminalTermuxView = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalTermuxView(
    {
      style,
      terminalTheme,
      textScale = 1,
      onWebReady,
      onModesChanged,
      onTerminalInput,
      onTerminalQueryReply,
      onTerminalTap,
      onSelectionMode,
      onSelectionCopy,
      onTextScaleChange,
      onFileTap,
      onOpenUrl,
      onKeyboardAvoidanceMetrics,
      onHaptic
    },
    ref
  ) {
    const nativeRef = useRef<TermuxTerminalNativeHandle>(null)
    const gridRef = useRef<{ cols: number; rows: number } | null>(null)
    const readyResolversRef = useRef<(() => void)[]>([])
    const announcedReadyRef = useRef(false)
    // expo-modules-core registers the native view after the first commit, so a command issued
    // on mount would reject with "unable to find view"; commands wait for the first grid.
    const pendingRef = useRef<(() => void)[]>([])
    const [hostFit, setHostFit] = useState(1)
    const hostFitRef = useRef(1)

    const theme = useMemo(() => termuxThemeFromMobileTheme(terminalTheme), [terminalTheme])

    const whenReady = useCallback((call: () => void) => {
      if (gridRef.current) {
        call()
      } else {
        pendingRef.current.push(call)
      }
    }, [])

    const handleTap = useCallback(
      (event: { nativeEvent: { line: string; col: number; row: number } }) => {
        const { line, col } = event.nativeEvent
        // Same order as the other engines: a file path under the finger opens the file, a URL
        // opens the browser, anything else focuses the keyboard.
        const fileUrl = findFileUrlAtColumn(line, col)
        const tapped = fileUrl ? resolveTerminalFileUrlTap(fileUrl) : null
        if (tapped && onFileTap) {
          onFileTap(tapped.pathText, tapped.line, tapped.column)
          return
        }
        const url = findUrlAtColumn(line, col)
        if (url && onOpenUrl) {
          onOpenUrl(url)
          return
        }
        onTerminalTap?.()
      },
      [onFileTap, onOpenUrl, onTerminalTap]
    )

    const handleMetrics = useCallback(
      (event: {
        nativeEvent: { cursorY: number; contentBottomRow: number; rows: number; altScreen: boolean }
      }) => onKeyboardAvoidanceMetrics?.(event.nativeEvent),
      [onKeyboardAvoidanceMetrics]
    )

    const handleResize = useCallback(
      (event: { nativeEvent: { cols: number; rows: number } }) => {
        gridRef.current = { cols: event.nativeEvent.cols, rows: event.nativeEvent.rows }
        for (const call of pendingRef.current.splice(0)) {
          call()
        }
        // The first grid is the native equivalent of the WebView's 'web-ready' and 'ready':
        // writes and measures are safe from here.
        if (!announcedReadyRef.current) {
          announcedReadyRef.current = true
          onWebReady?.()
        }
        const resolvers = readyResolversRef.current
        readyResolversRef.current = []
        for (const resolve of resolvers) {
          resolve()
        }
      },
      [onWebReady]
    )

    const handleModes = useCallback(
      (event: { nativeEvent: TermuxTerminalModesEvent }) => {
        const modes: TerminalModes = {
          altScreen: event.nativeEvent.altScreen,
          mouseTrackingMode: event.nativeEvent.mouseTrackingMode,
          sgrMouseMode: event.nativeEvent.sgrMouseMode,
          sgrMousePixelsMode: false,
          bracketedPasteMode: event.nativeEvent.bracketedPasteMode
        }
        onModesChanged?.(modes)
      },
      [onModesChanged]
    )

    // A host snapshot is a write like any other, and its replayed queries were answered as if
    // the agent had just asked (2026-09-13); the guard swallows what the replay makes the
    // emulator emit.
    const replayGuardRef = useRef(createTerminalReplayGuard())

    const handleInput = useCallback(
      (event: { nativeEvent: { text: string } }) => {
        const text = event.nativeEvent.text
        if (text.length === 0 || replayGuardRef.current.suppressed()) {
          return
        }
        // The terminal's own answers to the program's queries go to the PTY unconditionally,
        // or a program that asked stalls; wheel reports ride the gesture gate. A chunk that
        // carried two queries answers both in one payload (the native side flushes per chunk),
        // and the gate would drop that whole, so each answer goes on its own.
        const replies = extractOnlyTerminalQueryReplies(text)
        if (replies) {
          for (const reply of replies) {
            onTerminalQueryReply?.(reply)
          }
          return
        }
        onTerminalInput?.(text)
      },
      [onTerminalInput, onTerminalQueryReply]
    )

    const handleSelection = useCallback(
      (event: { nativeEvent: { active: boolean } }) => {
        if (event.nativeEvent.active) {
          onHaptic?.('selection')
        }
        onSelectionMode?.(event.nativeEvent.active)
      },
      [onHaptic, onSelectionMode]
    )
    const handleCopy = useCallback(
      (event: { nativeEvent: { text: string } }) => onSelectionCopy?.(event.nativeEvent.text),
      [onSelectionCopy]
    )
    const handleFontSize = useCallback(
      (event: { nativeEvent: { fontSize: number } }) => {
        // The pinch is on the fitted size; report the user's scale, not the fit, snapped to a
        // preset (the preference store keeps only presets).
        const fit = hostFitRef.current || 1
        const raw = event.nativeEvent.fontSize / (TERMUX_BASE_FONT_DP * fit)
        const snapped = TERMINAL_TEXT_SCALES.reduce((best, preset) =>
          Math.abs(preset - raw) < Math.abs(best - raw) ? preset : best
        )
        onTextScaleChange?.(snapped)
      },
      [onTextScaleChange]
    )

    useImperativeHandle(
      ref,
      () => ({
        prepareForForegroundRecovery() {
          // Android keeps the native grid across a background; nothing to re-arm.
        },
        write(data: string) {
          whenReady(() => void nativeRef.current?.writeText(data))
        },
        init(_cols, _rows, initialData) {
          // The host's snapshot supersedes whatever the grid held, when there is one. An empty
          // snapshot would only blank a grid an agent that repaints changed rows never fills.
          if (!initialData) {
            return
          }
          whenReady(() => {
            void replayGuardRef.current.replay(() =>
              nativeRef.current?.writeText(RESET_SEQUENCE + initialData)
            )
          })
        },
        resize(cols) {
          // Layout owns the grid, unless the host keeps a width of its own, in which case the
          // font scales until the grid matches what it addresses.
          const grid = gridRef.current
          if (!grid || cols <= 0 || grid.cols === cols) {
            return
          }
          const base = TERMUX_BASE_FONT_DP * textScale
          const wanted = hostFitRef.current * (grid.cols / cols)
          const clamped = Math.min(MAX_FONT_DP / base, Math.max(MIN_FONT_DP / base, wanted))
          hostFitRef.current = clamped
          setHostFit(clamped)
        },
        reflow() {
          // The emulator reflows its own transcript on a width change.
        },
        clear() {
          // The same bytes as a snapshot's prefix: Termux's reset() alone touches no cell, and
          // its transcript clear would land on whichever buffer is current.
          whenReady(() => void nativeRef.current?.writeText(RESET_SEQUENCE))
        },
        measureFitDimensions() {
          const grid = gridRef.current
          return Promise.resolve(grid && grid.cols >= 20 && grid.rows >= 8 ? { ...grid } : null)
        },
        resetZoom() {
          // A pinch step never changes the native size itself; the base is re-applied via fontSize.
        },
        cancelSelect() {
          whenReady(() => void nativeRef.current?.cancelSelect())
        },
        doSelectAll() {
          // Termux selects by handles from a long press; no caller in the app asks for select-all.
        },
        awaitReady() {
          if (gridRef.current) {
            return Promise.resolve()
          }
          return new Promise<void>((resolve) => {
            readyResolversRef.current.push(resolve)
          })
        }
      }),
      [textScale, whenReady]
    )

    return (
      <View style={style}>
        <TermuxTerminalNativeView
          ref={nativeRef}
          style={styles.fill}
          fontSize={TERMUX_BASE_FONT_DP * textScale * hostFit}
          theme={theme}
          onResize={handleResize}
          onModes={handleModes}
          onInput={handleInput}
          onSelection={handleSelection}
          onCopy={handleCopy}
          onFontSize={handleFontSize}
          onTap={handleTap}
          onMetrics={handleMetrics}
        />
      </View>
    )
  }
)

const styles = StyleSheet.create({ fill: { flex: 1 } })
