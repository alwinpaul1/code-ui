import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState,
  type MacHostState
} from './mac-host-state'
import {
  THROWAWAY_TERMINAL_POLL_MS,
  watchThrowawayTerminal,
  type ThrowawayTerminalClient
} from './throwaway-terminal'

export const MAC_HOST_STATE_PROBE_INTERVAL_MS = THROWAWAY_TERMINAL_POLL_MS
export const MAC_HOST_STATE_PROBE_TIMEOUT_MS = 4000

/** Opens the same kind of throwaway terminal the actions use, watches its screen for
 *  the marker line, then closes the tab. Never guesses: a screen that never paints the
 *  marker comes back unknown, and the sheet then offers every row. */
export async function probeMacHostState(args: {
  client: ThrowawayTerminalClient
  worktreeId: string
}): Promise<MacHostState> {
  const outcome = await watchThrowawayTerminal({
    client: args.client,
    worktreeId: args.worktreeId,
    command: MAC_HOST_STATE_PROBE_COMMAND,
    timeoutMs: MAC_HOST_STATE_PROBE_TIMEOUT_MS,
    read: (lines) => {
      const state = parseMacHostState(lines)
      return state.lock === 'unknown' ? null : state
    }
  })
  return outcome.ok && outcome.answer ? outcome.answer : UNKNOWN_MAC_HOST_STATE
}
