import type { RpcResponse } from '../transport/types'

/**
 * How long a tab the user closed stays off the strip while its close is still in flight.
 *
 * The phone drops the tab on tap and only then sends the close. Orca answers once its renderer
 * has retired the tab and flushed the workspace session, and gives that renderer up to 20 s
 * (`TERMINAL_TAB_CLOSE_TIMEOUT_MS`, read in the Orca 1.4.178-rc.2 source) before it fails the
 * close. A snapshot that lands in that window still lists the tab, so the tombstone outlasts
 * that wait; the snapshot gate drops it early the moment a snapshot no longer lists the tab.
 * A request that first waits out a relay re-dial can run longer than this; the tab can then
 * come back with that snapshot until the host's next publication settles it.
 */
export const CLOSE_IN_FLIGHT_TOMBSTONE_MS = 30_000

/** The tombstone a landed close keeps, for the snapshots already on their way. */
export const CLOSED_TAB_TOMBSTONE_MS = 10_000

/**
 * The host's answer to a phone-initiated close, as the strip needs it: closed, already gone, or
 * refused with a reason a person can read.
 *
 * `tab_not_found` and `terminal_tab_not_found` mean the desktop no longer has the tab, which is
 * what the user asked for; putting it back would draw a tab that does not exist.
 */
export type SessionTabCloseVerdict =
  | { kind: 'closed' }
  | { kind: 'refused'; reason: string }

// `terminal_handle_stale` and `terminal_not_found` are what `terminal.close` throws for a split
// leaf whose PTY or handle is already gone (Orca's getLiveLeafForHandle). Before the optimistic
// close the handle path dropped the leaf whatever the answer; reading these as refusals put a
// dead leaf back on every tap (Opus review, 2026-10-12).
const GONE_CODES = new Set([
  'tab_not_found',
  'terminal_tab_not_found',
  'terminal_gone',
  'terminal_exited',
  'terminal_handle_stale',
  'terminal_not_found'
])

const REASONS: Record<string, string> = {
  terminal_tab_pinned: 'it is pinned on the desktop',
  terminal_tab_close_timeout: 'the desktop did not answer in time',
  runtime_unavailable: 'Orca on the desktop is not available',
  renderer_unavailable: 'Orca on the desktop is not available',
  'stale-terminal': 'the desktop has a newer terminal in that tab',
  'stale-publication': 'the desktop tab list changed',
  'live-host-pty': 'its terminal is still running on the desktop',
  'retirement-owner': 'only the desktop can close it',
  'unknown-liveness': 'the desktop could not tell whether it is still running'
}

function describe(code: string | undefined, message: string | undefined): string {
  if (message?.startsWith('Request timed out')) {
    // The transport's own wording names the RPC method, which means nothing to the user.
    return REASONS.terminal_tab_close_timeout!
  }
  return (code && REASONS[code]) || (message && REASONS[message]) || message || code || 'the desktop refused'
}

/**
 * Reads a close reply. A failure names its cause in `error.code` or, for the runtime's plain
 * `Error`s, in `error.message`; a success that carries `refused: true` names it in
 * `refusalReason`.
 */
export function readSessionTabCloseReply(response: RpcResponse): SessionTabCloseVerdict {
  if (!response.ok) {
    const { code, message } = response.error
    if (GONE_CODES.has(code) || GONE_CODES.has(message)) {
      return { kind: 'closed' }
    }
    return { kind: 'refused', reason: describe(code, message) }
  }
  const result = response.result
  if (result !== null && typeof result === 'object' && 'refused' in result && result.refused === true) {
    const refusalReason =
      'refusalReason' in result && typeof result.refusalReason === 'string'
        ? result.refusalReason
        : undefined
    return { kind: 'refused', reason: describe(refusalReason, undefined) }
  }
  return { kind: 'closed' }
}

/** A close that never got an answer: the relay dropped, or the request was refused locally. */
export function readSessionTabCloseError(error: unknown): SessionTabCloseVerdict {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'refused', reason: message ? describe(undefined, message) : 'the desktop could not be reached' }
}

export function sessionTabCloseRefusedToast(title: string | undefined, reason: string): string {
  const name = title?.trim() || 'the tab'
  return `Couldn't close ${name}: ${reason}`
}

/**
 * Puts a tab whose close was refused back on the strip at the place it was tapped from. A tab a
 * snapshot already brought back stays where the snapshot put it.
 */
export function restoreRefusedSessionTab<T extends { id: string }>(
  tabs: readonly T[],
  tab: T,
  index: number
): T[] {
  if (tabs.some((candidate) => candidate.id === tab.id)) {
    return [...tabs]
  }
  const at = Math.max(0, Math.min(index, tabs.length))
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)]
}

/** The same for a terminal record, which is keyed by its handle. */
export function restoreRefusedTerminalRecord<T extends { handle: string }>(
  terminals: readonly T[],
  record: T,
  index: number
): T[] {
  if (terminals.some((candidate) => candidate.handle === record.handle)) {
    return [...terminals]
  }
  const at = Math.max(0, Math.min(index, terminals.length))
  return [...terminals.slice(0, at), record, ...terminals.slice(at)]
}
