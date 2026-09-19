import { RelayOuterError } from './mobile-relay-e2ee-link'
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
    code: source === 'dial' ? 'relay-dial-failed' : 'relay-session-failed',
    ...(error instanceof RelayOuterError ? { relayCloseCode: error.code } : {})
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

/** Consecutive refusals a dial must collect before the phone stops trying.
 *
 *  One is not enough. A credential rotating under an in-flight dial answers 401
 *  once and the next dial succeeds; arming on that single answer parked a
 *  healthy phone for the length of the slow reprobe, which is the opposite of
 *  the bug this exists to fix. Two in a row is a refusal, not a race: the
 *  reported failure was forty-odd of them in eight minutes, so nothing real is
 *  lost by spending one more dial to be sure (2026-09-14 review).
 */
export const RELAY_CREDENTIAL_REFUSALS_BEFORE_REPROBE = 2

/** Consecutive 401s seen while dialling. Cleared by anything that is not one. */
export type RelayCredentialRefusalRun = { consecutive: number }

export function createRelayCredentialRefusalRun(): RelayCredentialRefusalRun {
  return { consecutive: 0 }
}

/**
 * Logs a failed dial, and treats a REPEATEDLY refused credential as unusable.
 *
 * A 401 is not a failure another dial can clear. Without this the phone
 * re-dialled on the ordinary backoff and took forty-odd 401s in eight minutes:
 * the slow reprobe that exists for an unusable credential only ran when there
 * was NO credential at all (reported from another person's phone, 2026-09-14).
 */
export function noteRelayDialFailure(
  log: RelayRecoveryLog,
  error: Error | null,
  armCredentialReprobe: () => void,
  // Required, not defaulted: a fresh run per call would count 0->1 forever and
  // never arm — the fix reintroduced from the other side. The tracker below
  // owns the one persistent run; callers pass it (2026-09-14 review).
  run: RelayCredentialRefusalRun
): void {
  logRelayDialFailure(log, error)
  if (!isRelayCredentialRejected(error)) {
    // Any other answer means the credential was not the thing being judged.
    run.consecutive = 0
    return
  }
  run.consecutive += 1
  if (run.consecutive < RELAY_CREDENTIAL_REFUSALS_BEFORE_REPROBE) {
    return
  }
  logRelayCredentialUnavailable(log, true)
  armCredentialReprobe()
}

/** A dial that got through: the run of refusals is over. */
export function noteRelayDialSucceeded(run: RelayCredentialRefusalRun): void {
  run.consecutive = 0
}


/** Owns a run of consecutive dial refusals and the reprobe it arms, so a caller
 *  can hand it a dial outcome without also holding the counter. Constructed with
 *  the reprobe to arm; `noteFailure` arms it on the second refusal in a row,
 *  `noteConnected` clears the run when a dial gets through. */
export class RelayCredentialRefusalTracker {
  private readonly run = createRelayCredentialRefusalRun()

  constructor(private readonly armCredentialReprobe: () => void) {}

  noteFailure(log: RelayRecoveryLog, error: Error | null): void {
    noteRelayDialFailure(log, error, this.armCredentialReprobe, this.run)
  }

  noteConnected(): void {
    noteRelayDialSucceeded(this.run)
  }
}
