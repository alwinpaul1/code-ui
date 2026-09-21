import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { PixelRatio, ScrollView, StyleSheet, View } from 'react-native'
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
 *   its own via onResize and the host fits the PTY to that. A host that keeps a NARROWER width
 *   gets the font scaled up until the grid matches what it addresses. A host that keeps a
 *   WIDER one (the desktop window showing the tab at 126 columns, 2026-09-21) used to get the
 *   font shrunk to 8 px; now the view is widened to that many columns at the reader's size
 *   and pans sideways, since Claude Code keeps its text at the left.
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
    /** The grid the SCREEN fits at the current font: what the host is asked to follow. A
     *  widened view reports the host's columns instead, which are not a fit. */
    const gridRef = useRef<{ cols: number; rows: number } | null>(null)
    const cellRef = useRef<{ width: number; height: number } | null>(null)
    const readyResolversRef = useRef<(() => void)[]>([])
    const announcedReadyRef = useRef(false)
    // expo-modules-core registers the native view after the first commit, so a command issued
    // on mount would reject with "unable to find view"; commands wait for the first grid.
    const pendingRef = useRef<(() => void)[]>([])
    const [hostFit, setHostFit] = useState(1)
    const hostFitRef = useRef(1)
    /** The view's width in dp while the host holds more columns than the screen fits; null
     *  otherwise. Termux takes floor(width / cellWidth) columns, hence the extra pixel. */
    const [panWidth, setPanWidth] = useState<number | null>(null)
    const panWidthRef = useRef<number | null>(null)
    /** The view's height in dp while the host holds fewer rows than the screen fits, so its
     *  bottom row (the prompt) sits over the keyboard instead of mid-pane; null otherwise. */
    const [heldHeight, setHeldHeight] = useState<number | null>(null)
    const heldHeightRef = useRef<number | null>(null)

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
      (event: { nativeEvent: { cols: number; rows: number; cellWidth: number; cellHeight: number } }) => {
        const { cols, rows, cellWidth, cellHeight } = event.nativeEvent
        cellRef.current = { width: cellWidth, height: cellHeight }
        // A held size reports the host's grid, which is not what the screen fits.
        const held = gridRef.current
        gridRef.current = {
          cols: panWidthRef.current === null || !held ? cols : held.cols,
          rows: heldHeightRef.current === null || !held ? rows : held.rows
        }
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
        resize(cols, rows) {
          // Layout owns the grid, unless the host keeps a size of its own. Wider than the
          // screen fits: the view is widened to the host's columns and pans. Narrower: the
          // font scales up until the grid matches what the host addresses. Shorter: the view
          // is that many rows tall, at the bottom of the pane.
          const grid = gridRef.current
          const cell = cellRef.current
          if (!grid || !cell || cols <= 0) {
            return
          }
          const density = PixelRatio.get()
          const height = rows > 0 && rows < grid.rows ? (rows * cell.height * density + 1) / density : null
          if (heldHeightRef.current !== height) {
            heldHeightRef.current = height
            setHeldHeight(height)
          }
          if (cols > grid.cols) {
            const width = (cols * cell.width * density + 1) / density
            if (panWidthRef.current !== width) {
              panWidthRef.current = width
              setPanWidth(width)
            }
            if (hostFitRef.current !== 1) {
              hostFitRef.current = 1
              setHostFit(1)
            }
            return
          }
          if (panWidthRef.current !== null) {
            panWidthRef.current = null
            setPanWidth(null)
          }
          if (grid.cols === cols) {
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

    const terminal = (
      <TermuxTerminalNativeView
        ref={nativeRef}
        style={
          panWidth === null && heldHeight === null
            ? styles.fill
            : { width: panWidth ?? '100%', height: heldHeight ?? '100%' }
        }
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
    )
    return (
      <View style={[style, heldHeight === null ? null : styles.paneBottom]} testID="termux-terminal-pane">
        {panWidth === null ? (
          terminal
        ) : (
          // Horizontal only: Termux keeps every vertical gesture (its own transcript, or wheel
          // reports for a program that tracks the mouse), and the pane pans sideways.
          <ScrollView
            horizontal
            bounces={false}
            showsHorizontalScrollIndicator
            style={styles.fill}
            contentContainerStyle={styles.panContent}
          >
            {terminal}
          </ScrollView>
        )}
      </View>
    )
  }
)

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panContent: { flexGrow: 1 },
  paneBottom: { justifyContent: 'flex-end' }
})
