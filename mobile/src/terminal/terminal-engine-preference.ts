/**
 * Which engine draws a terminal pane. 'termux' is Termux's terminal
 * (com.termux.view and com.termux.terminal, vendored into
 * packages/expo-termux-terminal with a relay-fed session in place of the
 * PTY-bound one), the engine terminal mode uses. 'ghostty' is libghostty-vt in
 * a native view, the engine from 0.4 until this switch; 'webview' is xterm.js
 * inside react-native-webview, the engine every release before 0.4 shipped.
 * Both remain as code paths for tests, not as user choices.
 *
 * A flag, not a fork: every engine implements the same TerminalWebViewHandle,
 * so the session code does not know which one it has.
 */
export type TerminalEngine = 'webview' | 'ghostty' | 'termux'
