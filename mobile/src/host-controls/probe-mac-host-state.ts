import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState,
  type MacHostState
} from './mac-host-state'
import { WINDOWS_HOST_STATE_PROBE_COMMAND, parseWindowsHostState } from './windows-host-state'
import {
  THROWAWAY_TERMINAL_POLL_MS,
  watchThrowawayTerminal,
  type ThrowawayTerminalClient
} from './throwaway-terminal'

export const MAC_HOST_STATE_PROBE_INTERVAL_MS = THROWAWAY_TERMINAL_POLL_MS
// The two questions take about a second each and a relay round trip sits on top
// of every poll, so four seconds could not cover them (2026-09-14).
export const MAC_HOST_STATE_PROBE_TIMEOUT_MS = 12000
/** A cold `powershell` start and the Core Audio compile; see WINDOWS_HOST_COMMAND_TIMEOUT_MS. */
export const WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS = 15000

/** Opens the same kind of throwaway terminal the actions use, watches its screen for
 *  the marker line, then closes the tab. Never guesses: a screen that never paints the
 *  marker comes back unknown, and the sheet then offers every row. */
export async function probeMacHostState(args: {
  client: ThrowawayTerminalClient
  worktreeId: string
  /** 'win32' asks the Windows probe; anything else the Mac one. */
  platform?: NodeJS.Platform
}): Promise<MacHostState> {
  const windows = args.platform === 'win32'
  const parse = windows ? parseWindowsHostState : parseMacHostState
  const outcome = await watchThrowawayTerminal({
    client: args.client,
    worktreeId: args.worktreeId,
    command: windows ? WINDOWS_HOST_STATE_PROBE_COMMAND : MAC_HOST_STATE_PROBE_COMMAND,
    timeoutMs: windows ? WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS : MAC_HOST_STATE_PROBE_TIMEOUT_MS,
    read: (lines) => {
      const state = parse(lines)
      return state.lock === 'unknown' ? null : state
    }
  })
  return outcome.ok && outcome.answer ? outcome.answer : UNKNOWN_MAC_HOST_STATE
}
