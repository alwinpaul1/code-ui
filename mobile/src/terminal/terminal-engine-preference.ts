import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Which engine draws a terminal pane.
 *
 * 'webview' is xterm.js inside react-native-webview, the engine every release
 * so far has shipped. 'ghostty' is libghostty-vt drawn by a native view, the
 * engine the 120 Hz work targets: measured on a Galaxy S23, the WebView paints
 * 14.4 frames/s under a real Claude Code repaint stream that the host delivers
 * at 57, and the chat list beside it paints 120.
 *
 * Default stays 'webview' until the ghostty engine passes Stage 0 — replaying
 * real captured Claude Code and Codex streams with correct rendering and a
 * measured frame rate. A flag, not a fork: both engines implement the same
 * TerminalWebViewHandle, so the session code does not know which one it has.
 */
export type TerminalEngine = 'webview' | 'ghostty'

const KEY = 'terminalEngine'

export function parseTerminalEngine(raw: string | null): TerminalEngine {
  return raw === 'ghostty' ? 'ghostty' : 'webview'
}

export async function loadTerminalEngine(): Promise<TerminalEngine> {
  try {
    return parseTerminalEngine(await AsyncStorage.getItem(KEY))
  } catch {
    return 'webview'
  }
}

export async function saveTerminalEngine(engine: TerminalEngine): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, engine)
  } catch {
    // Why: a failed write must not block the switch; the next launch re-reads.
  }
}
