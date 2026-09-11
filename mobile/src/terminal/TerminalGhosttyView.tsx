import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { TerminalView, type TerminalViewRef } from 'expo-libghostty'
import { ghosttyThemeFromMobileTheme } from './ghostty-theme-from-mobile-theme'
import { terminalModesFromGhosttyMask } from './terminal-modes-from-ghostty-mask'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'

/** 13 dp at scale 1, the size the Stage 0 replays were measured at. */
const GHOSTTY_BASE_FONT_DP = 13

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
    { style, terminalTheme, textScale = 1, onWebReady, onModesChanged, onTerminalInput, onTerminalTap },
    ref
  ) {
    const nativeRef = useRef<TerminalViewRef>(null)
    const gridRef = useRef<{ cols: number; rows: number } | null>(null)
    const readyResolversRef = useRef<(() => void)[]>([])
    const announcedReadyRef = useRef(false)

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
        // With managesFocus off the only bytes the view emits are the wheel
        // reports its scroll handler encodes; they ride the session's gesture
        // gate like the WebView's do.
        if (event.nativeEvent.text.length > 0) {
          onTerminalInput?.(event.nativeEvent.text)
        }
      },
      [onTerminalInput]
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
        resize() {
          // Layout owns the grid; the host learns the size from onResize.
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
          // Not exposed by the module yet; a no-op keeps the contract honest.
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
      []
    )

    return (
      // The tap lands on a wrapper: the native view owns no focus, so a tap is
      // the host's to interpret (focus the live input), exactly as for xterm.
      <View style={style} onTouchEnd={onTerminalTap ? () => onTerminalTap() : undefined}>
        <TerminalView
          ref={nativeRef}
          style={styles.fill}
          fontSize={GHOSTTY_BASE_FONT_DP * textScale}
          theme={theme}
          managesFocus={false}
          showsAccessoryBar={false}
          managesKeyboardInsets={false}
          onResize={handleResize}
          onModes={handleModes}
          onInput={handleInput}
        />
      </View>
    )
  }
)

const styles = StyleSheet.create({ fill: { flex: 1 } })
