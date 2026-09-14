import type { RelayRecoveryLog } from './mobile-relay-recovery-log'
import { RelayDirectorHttpError, isRelayCredentialRejected } from './mobile-relay-resume-director'

export function logRelayConnected(
  log: RelayRecoveryLog,
  dialDurationMs?: number,
  legs?: string
): void {
  // The dial time is the number a "slow to connect" report needs, and the legs
  // (socket open, relay hello, E2EE, resume confirm) say where it went.
  const total = dialDurationMs === undefined ? null : `dialed in ${(dialDurationMs / 1000).toFixed(1)}s`
  const detail = total && legs ? `${total} (${legs})` : (total ?? legs)
  log('runtime channel migrated to relay', detail, {
    level: 'success',
    code: 'relay-connected'
  })
}

export function logRelayDialFailure(
  log: RelayRecoveryLog,
  error: Error | null,
  source: 'dial' | 'active-session' = 'dial'
): void {
  if (!error) {
    return
  }
  const base = `${error.name}: ${String(error.message).slice(0, 160)}`
  const detail =
    error instanceof RelayDirectorHttpError && error.retryAfterMs != null
      ? `${base}; retry-after=${error.retryAfterMs}ms`
      : base
  log(source === 'dial' ? 'relay dial failed' : 'active relay session failed', detail, {
    level: 'error',
    code: source === 'dial' ? 'relay-dial-failed' : 'relay-session-failed'
  })
}

export function logRelayCredentialUnavailable(log: RelayRecoveryLog, hasBundle: boolean): void {
  log(
    hasBundle
      ? 'relay credential expired or rejected; slow reprobe armed'
      : 'no relay credential bundle; slow reprobe armed',
    undefined,
    { level: 'warn', code: 'relay-credential-unavailable' }
  )
}

/**
 * Logs a failed dial, and treats a REFUSED credential as one.
 *
 * A 401 is not a failure another dial can clear. Without this the phone
 * re-dialled on the ordinary backoff and took forty-odd 401s in eight minutes:
 * the slow reprobe that exists for an unusable credential only ran when there
 * was NO credential at all (reported from another person's phone, 2026-09-14).
 */
export function noteRelayDialFailure(
  log: RelayRecoveryLog,
  error: Error | null,
  armCredentialReprobe: () => void
): void {
  logRelayDialFailure(log, error)
  if (isRelayCredentialRejected(error)) {
    logRelayCredentialUnavailable(log, true)
    armCredentialReprobe()
  }
}
