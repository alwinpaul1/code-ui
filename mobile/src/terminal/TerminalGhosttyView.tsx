import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { TerminalView, type TerminalViewRef } from 'expo-libghostty'
import { ghosttyThemeFromMobileTheme } from './ghostty-theme-from-mobile-theme'
import { terminalModesFromGhosttyMask } from './terminal-modes-from-ghostty-mask'
import { findFileUrlAtColumn, findUrlAtColumn, resolveTerminalFileUrlTap } from './terminal-webview-url-tap'
import { TERMINAL_TEXT_SCALES } from '../storage/preferences'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { isTerminalQueryReply } from '../../../src/shared/terminal-query-reply'

/** 13 dp at scale 1, the size the Stage 0 replays were measured at. */
const GHOSTTY_BASE_FONT_DP = 13

/** The module clamps fontSize to this range; keep the fit inside it. */
const MIN_FONT_DP = 4
const MAX_FONT_DP = 64

/** A touch that travels further than this is a scroll, not a tap. */

/** RIS then a scrollback erase: a fresh grid for a fresh snapshot. */
const RESET_SEQUENCE = 'c[3J'

/**
 * The libghostty engine behind the same handle the session drives the WebView
 * with, so nothing above this file knows which engine it has.
 *
 * Measured on a Galaxy S23 replaying a real Claude Code repaint stream: xterm
 * commits a full-screen repaint in ~50 ms (≈12 paints/s against the 57/s the
 * host delivers under a scroll — the user's 14 fps), libghostty parses the
 * same repaint in 5–7 ms with no UI-thread hold over 34 ms. This view is what
 * turns that into pixels on an agent tab.
 *
 * Where the contract meets a native grid:
 * - The grid is layout-driven. `init`/`resize`/`reflow` cannot set cols/rows;
 *   the view reports its own via onResize and the host fits the PTY to that.
 * - There is no bridge to coalesce for: writes go straight to the native
 *   parser. The WebView's 48 ms write window exists to amortise postMessage
 *   cost this view does not pay, and behind it ANY engine caps near 21
 *   paints/s (measured), so it is deliberately absent here.
 * - Scroll is handled natively: on a mouse-tracking program (Claude Code) the
 *   patched view turns the gesture into wheel reports and emits them through
 *   onInput; otherwise it scrolls its own history. onModes mirrors the
 *   program's modes so the session's gesture gate treats both engines alike.
 * - Focus, the IME and the accessory row stay with React Native
 *   (managesFocus/showsAccessoryBar/managesKeyboardInsets false).
 */
export const TerminalGhosttyView = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalGhosttyView(
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
    const nativeRef = useRef<TerminalViewRef>(null)
    const gridRef = useRef<{ cols: number; rows: number } | null>(null)
    const readyResolversRef = useRef<(() => void)[]>([])
    const announcedReadyRef = useRef(false)
    // Taps arrive from the native view's own gesture detector (onTap), which
    // fires for a single tap only — never for a scroll, a fling or the long
    // press that starts a selection — so the keyboard opens only for a tap.
    // Reviewed 2026-09-11: the wrapper's touch-end heuristic treated a
    // stationary long-press release as a tap and popped the keyboard over the
    // selection. A program that tracks the mouse gets the tap as a click in
    // the native view instead, and no onTap is emitted.
    const handleTap = useCallback(
      (event: { nativeEvent: { line: string; col: number; row: number } }) => {
        const { line, col } = event.nativeEvent
        // Same order as the WebView: a file path under the finger opens the
        // file, a URL opens the browser, anything else focuses the keyboard.
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
    // Measured on a 1080 px view at 13 dp: the layout gives 49 columns. A host
    // that keeps its own width (the `hold`/`exhausted` case) addresses cells the
    // view does not have, rows wrap and every partial repaint lands a row off.
    // xterm escaped by CSS-scaling its canvas; here the font scales so the grid
    // the host expects is the grid it gets.
    const [hostFit, setHostFit] = useState(1)
    const hostFitRef = useRef(1)

    const theme = useMemo(() => ghosttyThemeFromMobileTheme(terminalTheme), [terminalTheme])

    const handleResize = useCallback(
      (event: { nativeEvent: { cols: number; rows: number } }) => {
        gridRef.current = { cols: event.nativeEvent.cols, rows: event.nativeEvent.rows }
        // The first layout is the native equivalent of the WebView's 'web-ready'
        // and 'ready': the grid exists, so writes and measures are safe.
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
      (event: { nativeEvent: { mask: number } }) => {
        onModesChanged?.(terminalModesFromGhosttyMask(event.nativeEvent.mask))
      },
      [onModesChanged]
    )

    const handleInput = useCallback(
      (event: { nativeEvent: { text: string } }) => {
        const text = event.nativeEvent.text
        if (text.length === 0) {
          return
        }
        // Two kinds of bytes come up from the native view, and the WebView
        // path already splits them the same way: the terminal's own answers to
        // the program's queries (device attributes, cursor position) go to the
        // PTY unconditionally, or a program that asked stalls waiting; the
        // wheel reports the scroll handler encodes ride the gesture gate.
        if (isTerminalQueryReply(text)) {
          onTerminalQueryReply?.(text)
          return
        }
        onTerminalInput?.(text)
      },
      [onTerminalInput, onTerminalQueryReply]
    )

    // Selection, copy and pinch stay native; the host hears about them the way
    // it hears about xterm's, so its selection UI, copy toast and persisted
    // text size behave identically whichever engine draws the pane.
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
        // The pinch is on the fitted size; report the user's scale, not the fit,
        // snapped to a preset — the preference store keeps only presets, and an
        // unsnapped 1.2500000149 was read back as 1 on the next focus.
        const fit = hostFitRef.current || 1
        const raw = event.nativeEvent.fontSize / (GHOSTTY_BASE_FONT_DP * fit)
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
          void nativeRef.current?.writeText(data)
        },
        init(_cols, _rows, initialData) {
          // The host's snapshot supersedes whatever the grid held.
          void nativeRef.current?.writeText(RESET_SEQUENCE + (initialData ?? ''))
        },
        resize(cols) {
          // Layout owns the grid — unless the host keeps a width of its own, in
          // which case the font scales until the grid matches what it addresses.
          const grid = gridRef.current
          if (!grid || cols <= 0 || grid.cols === cols) {
            return
          }
          const base = GHOSTTY_BASE_FONT_DP * textScale
          const wanted = hostFitRef.current * (grid.cols / cols)
          const clamped = Math.min(MAX_FONT_DP / base, Math.max(MIN_FONT_DP / base, wanted))
          hostFitRef.current = clamped
          setHostFit(clamped)
        },
        reflow() {
          // libghostty reflows its own history on a width change.
        },
        clear() {
          void nativeRef.current?.writeText(RESET_SEQUENCE)
        },
        measureFitDimensions() {
          const grid = gridRef.current
          return Promise.resolve(grid && grid.cols >= 20 && grid.rows >= 8 ? { ...grid } : null)
        },
        resetZoom() {
          // Pinch zoom is the native view's; the base size is re-applied via fontSize.
        },
        cancelSelect() {
          // Selection is native and clears on the next tap.
        },
        doSelectAll() {
          void nativeRef.current?.selectAll()
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
      [textScale]
    )

    return (
      // The tap lands on a wrapper: the native view owns no focus, so a tap is
      // the host's to interpret (focus the live input), exactly as for xterm.
      <View style={style}>
        <TerminalView
          ref={nativeRef}
          style={styles.fill}
          fontSize={GHOSTTY_BASE_FONT_DP * textScale * hostFit}
          theme={theme}
          managesFocus={false}
          showsAccessoryBar={false}
          managesKeyboardInsets={false}
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
