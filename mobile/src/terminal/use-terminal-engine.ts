import type { TerminalEngine } from './terminal-engine-preference'

/** Which engine draws terminal panes: Termux's terminal in a native view. The
 *  libghostty and xterm.js engines stay in the tree, selectable by tests
 *  through TerminalPaneView's `engine` prop, but not by the user — one
 *  engine, one set of behaviours. */
export function useTerminalEngine(): TerminalEngine {
  return 'termux'
}
