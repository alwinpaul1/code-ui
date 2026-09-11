import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Which engine draws a terminal pane.
 *
 * 'ghostty' is libghostty-vt drawn by a native view, and the default: on a
 * corrected 51x38 grid it paints Claude Code's real repaint stream at 55
 * distinct frames/s with 5–8 ms parses and no UI-thread hold over 35 ms, where
 * xterm behind the 48 ms write coalescer paints ~13. 'webview' is xterm.js
 * inside react-native-webview, the engine every release before this shipped;
 * it stays selectable under Settings > Terminal > Rendering as the fallback.
 *
 * A flag, not a fork: both engines implement the same TerminalWebViewHandle,
 * so the session code does not know which one it has.
 */
export type TerminalEngine = 'webview' | 'ghostty'

const KEY = 'terminalEngine'

export function parseTerminalEngine(raw: string | null): TerminalEngine {
  return raw === 'webview' ? 'webview' : 'ghostty'
}

export async function loadTerminalEngine(): Promise<TerminalEngine> {
  try {
    return parseTerminalEngine(await AsyncStorage.getItem(KEY))
  } catch {
    return 'ghostty'
  }
}

export async function saveTerminalEngine(engine: TerminalEngine): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, engine)
  } catch {
    // Why: a failed write must not block the switch; the next launch re-reads.
  }
}
