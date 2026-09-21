import type { TerminalEngine } from './terminal-engine-preference'

/** Which engine draws terminal panes: libghostty-vt in a native view. The
 *  xterm.js WebView stays in the tree as the engine every release before
 *  0.4 shipped, selectable by tests through TerminalPaneView's `engine`
 *  prop, but no longer by the user — one engine, one set of behaviours. */
export function useTerminalEngine(): TerminalEngine {
  return 'ghostty'
}
