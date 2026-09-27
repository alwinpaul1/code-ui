import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
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

/**
 * Why no relay credential could be dialled. One line used to say "expired or
 * rejected" for all of these, and a Keystore read failure logged the same way:
 * a report could not tell a phone that slept past expiry (re-pair or LAN) from
 * a refused credential (rotation over direct) or an unreadable store (Pixel,
 * 2026-09-27).
 */
type HeldCredential = { version: number; expiresAt: number; rejected: boolean }

export type RelayCredentialUnavailableReason =
  | { kind: 'expired'; version: number; expiresAt: number }
  | { kind: 'rejected'; version: number | null }
  // `held`: what memory still had, so the line says what the read could have replaced.
  | { kind: 'store-unreadable'; error: Error; held: HeldCredential | null }
  | { kind: 'missing' }

export function relayCredentialUnavailableReason(
  selection: { bundle: MobileRelayCredentialBundle | null; diskReadError?: Error },
  isRejected: (version: number) => boolean
): RelayCredentialUnavailableReason {
  const current = selection.bundle?.current
  if (selection.diskReadError) {
    const held = current ? { ...current, rejected: isRejected(current.version) } : null
    return { kind: 'store-unreadable', error: selection.diskReadError, held }
  }
  if (!current) {
    return { kind: 'missing' }
  }
  if (isRejected(current.version)) {
    return { kind: 'rejected', version: current.version }
  }
  return { kind: 'expired', version: current.version, expiresAt: current.expiresAt }
}

function describeUnavailable(reason: RelayCredentialUnavailableReason): [string, string?] {
  switch (reason.kind) {
    case 'expired':
      return [
        'relay credential expired; slow reprobe armed',
        `version ${reason.version} expired at ${new Date(reason.expiresAt).toISOString()}`
      ]
    case 'rejected':
      return [
        'relay credential rejected; slow reprobe armed',
        reason.version === null
          ? 'refused by the relay twice in a row'
          : `version ${reason.version} refused by the relay`
      ]
    case 'store-unreadable': {
      const error = `${reason.error.name}: ${String(reason.error.message).slice(0, 160)}`
      return [
        'relay credential store unreadable; slow reprobe armed',
        `${error}; ${describeHeld(reason.held)}`
      ]
    }
    case 'missing':
      return ['no relay credential bundle; slow reprobe armed']
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

function describeHeld(held: HeldCredential | null): string {
  if (!held) {
    return 'no credential held in memory'
  }
  const state = held.rejected
    ? 'refused by the relay'
    : `expired at ${new Date(held.expiresAt).toISOString()}`
  return `held version ${held.version} ${state}`
}

export function logRelayCredentialUnavailable(
  log: RelayRecoveryLog,
  reason: RelayCredentialUnavailableReason
): void {
  const [message, detail] = describeUnavailable(reason)
  log(message, detail, { level: 'warn', code: 'relay-credential-unavailable' })
}

/** Credential selection came back empty: log why. */
export function logNoDialableCredential(
  log: RelayRecoveryLog,
  selection: { bundle: MobileRelayCredentialBundle | null; diskReadError?: Error },
  isRejected: (version: number) => boolean
): void {
  logRelayCredentialUnavailable(log, relayCredentialUnavailableReason(selection, isRejected))
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
  // Returns false when it armed nothing (a stopped or backgrounded client).
  armCredentialReprobe: () => boolean | void,
  // Required, not defaulted: a fresh run per call would count 0->1 forever and
  // never arm — the fix reintroduced from the other side. The tracker below
  // owns the one persistent run; callers pass it (2026-09-14 review).
  run: RelayCredentialRefusalRun,
  // The credential the refused dial used, when the caller knows it.
  version: number | null = null
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
  if (armCredentialReprobe() === false) {
    return
  }
  logRelayCredentialUnavailable(log, { kind: 'rejected', version })
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

  constructor(private readonly armCredentialReprobe: () => boolean | void) {}

  noteFailure(log: RelayRecoveryLog, error: Error | null, version: number | null = null): void {
    noteRelayDialFailure(log, error, this.armCredentialReprobe, this.run, version)
  }

  noteConnected(): void {
    noteRelayDialSucceeded(this.run)
  }
}
