/**
 * Which engine draws a terminal pane. 'ghostty' is libghostty-vt drawn by a
 * native view: on a corrected 51x38 grid it paints Claude Code's real repaint
 * stream at 55 distinct frames/s with no UI-thread hold over 35 ms, where
 * xterm behind the 48 ms write coalescer paints ~13. 'webview' is xterm.js
 * inside react-native-webview, the engine every release before this shipped;
 * it remains as a code path for tests, not as a user choice.
 *
 * A flag, not a fork: both engines implement the same TerminalWebViewHandle,
 * so the session code does not know which one it has.
 */
export type TerminalEngine = 'webview' | 'ghostty'
