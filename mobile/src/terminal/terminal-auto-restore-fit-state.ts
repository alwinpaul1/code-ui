/**
 * The desktop's "restore the terminal after the phone leaves" setting, as the phone knows it.
 *
 * Orca answers terminal.getAutoRestoreFit and terminal.setAutoRestoreFit with { ms: number | null }
 * as the reply envelope's `result` (src/main/runtime/rpc/methods/terminal.ts, from
 * getMobileAutoRestoreFitMs: null is "keep at phone size", a finite value is clamped to the
 * desktop's range). A reply that is not that shape, an error reply and a rejected request all leave
 * the setting UNKNOWN. None of them is the default: drawing "Keep at phone size (default)" for a
 * desktop that restores after a minute tells the user something false.
 */
export const TERMINAL_AUTO_RESTORE_FIT_UNREADABLE = 'unreadable'

export type TerminalAutoRestoreFitValue = number | null | typeof TERMINAL_AUTO_RESTORE_FIT_UNREADABLE

/** Per desktop. `undefined` is "not read yet". */
export type TerminalAutoRestoreFitByHost = Record<string, TerminalAutoRestoreFitValue | undefined>

export function readTerminalAutoRestoreFitReply(reply: unknown): TerminalAutoRestoreFitValue {
  if (!reply || typeof reply !== 'object' || (reply as { ok?: unknown }).ok !== true) {
    return TERMINAL_AUTO_RESTORE_FIT_UNREADABLE
  }
  const result = (reply as { result?: unknown }).result
  if (!result || typeof result !== 'object' || !('ms' in result)) {
    return TERMINAL_AUTO_RESTORE_FIT_UNREADABLE
  }
  const ms = (result as { ms: unknown }).ms
  if (ms === null) {
    return null
  }
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? ms
    : TERMINAL_AUTO_RESTORE_FIT_UNREADABLE
}

/** A value the picker can preselect: read, and read successfully. */
export function isKnownTerminalAutoRestoreFit(
  value: TerminalAutoRestoreFitValue | undefined
): value is number | null {
  return value !== undefined && value !== TERMINAL_AUTO_RESTORE_FIT_UNREADABLE
}

export function setTerminalAutoRestoreFitMsForHost(
  current: TerminalAutoRestoreFitByHost,
  hostId: string,
  value: TerminalAutoRestoreFitValue
): TerminalAutoRestoreFitByHost {
  if (current[hostId] === value) {
    return current
  }
  return { ...current, [hostId]: value }
}

/**
 * Which connection each desktop's setting was last read on. The screen re-renders on every
 * connection-state tick of every desktop; reading on each of those spins against a desktop that
 * keeps failing. So the setting is read once per connection: a failed read waits for the next
 * connection (the stale-after-reconnect rule), and a good one is refreshed there too, since the
 * desktop may have changed it in between.
 */
export type TerminalAutoRestoreFitReadLedger = Map<string, number | null>

export function claimTerminalAutoRestoreFitRead(
  ledger: TerminalAutoRestoreFitReadLedger,
  hostId: string,
  lastConnectedAt: number | null
): boolean {
  if (ledger.has(hostId) && ledger.get(hostId) === lastConnectedAt) {
    return false
  }
  ledger.set(hostId, lastConnectedAt)
  return true
}
