import type { TerminalModes } from './terminal-webview-contract'

/**
 * The patched expo-libghostty view reports the program's DEC private modes as
 * one bitmask (`onModes`), read straight from libghostty after each write —
 * one JNI call per change instead of a scan of the byte stream. These are the
 * bit positions `nativeTerminalModes` assigns; keep them in step with
 * patches/expo-libghostty@0.8.1.patch.
 */
export const GHOSTTY_MODE_BIT = {
  normalMouse: 1 << 0, // DEC 1000
  buttonMouse: 1 << 1, // DEC 1002
  anyMouse: 1 << 2, // DEC 1003
  sgrMouse: 1 << 3, // DEC 1006
  altScreen: 1 << 4,
  altScroll: 1 << 5 // DEC 1007
} as const

/**
 * Maps the mask onto the same TerminalModes the WebView engine reports, so the
 * session's gesture gate (`handleTerminalInput`) treats both engines alike.
 * Claude Code enables 1000/1002/1003/1006 together; the most specific tracking
 * mode wins, as it does in xterm.
 */
export function terminalModesFromGhosttyMask(mask: number): TerminalModes {
  const mouseTrackingMode: TerminalModes['mouseTrackingMode'] =
    mask & GHOSTTY_MODE_BIT.anyMouse
      ? 'any'
      : mask & GHOSTTY_MODE_BIT.buttonMouse
        ? 'drag'
        : mask & GHOSTTY_MODE_BIT.normalMouse
          ? 'vt200'
          : 'none'
  return {
    // Not surfaced by the mask; the WebView reports it from the byte stream
    // and nothing on the phone acts on it yet.
    bracketedPasteMode: false,
    altScreen: (mask & GHOSTTY_MODE_BIT.altScreen) !== 0,
    mouseTrackingMode,
    sgrMouseMode: (mask & GHOSTTY_MODE_BIT.sgrMouse) !== 0,
    // DEC 1016 is not in the mask; libghostty's encoder handles it internally.
    sgrMousePixelsMode: false
  }
}
