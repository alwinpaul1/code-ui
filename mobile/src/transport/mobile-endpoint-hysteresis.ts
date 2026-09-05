export type EndpointHysteresisOptions = {
  directSuccessesRequired: number
  directObservationMs: number
  failureCooldownMs: number
  minimumDwellMs: number
  /** Ceiling for the cooldown as consecutive failures double it; omitted keeps
   *  the cooldown fixed. */
  maxFailureCooldownMs?: number
}

export class MobileEndpointHysteresis {
  private consecutiveDirectSuccesses = 0
  private consecutiveDirectFailures = 0
  private directObservationStartedAt: number | null = null
  private cooldownUntil = 0
  private lastMigrationAt: number

  constructor(
    startedAt: number,
    private readonly options: EndpointHysteresisOptions
  ) {
    this.lastMigrationAt = startedAt
  }

  recordDirectSuccess(now: number): boolean {
    if (now < this.cooldownUntil) {
      return false
    }
    if (this.consecutiveDirectSuccesses === 0) {
      this.directObservationStartedAt = now
    }
    this.consecutiveDirectFailures = 0
    this.consecutiveDirectSuccesses += 1
    return (
      this.consecutiveDirectSuccesses >= this.options.directSuccessesRequired &&
      this.directObservationStartedAt !== null &&
      now - this.directObservationStartedAt >= this.options.directObservationMs &&
      now - this.lastMigrationAt >= this.options.minimumDwellMs
    )
  }

  recordDirectFailure(now: number): void {
    this.consecutiveDirectSuccesses = 0
    this.directObservationStartedAt = null
    this.consecutiveDirectFailures += 1
    // Why: a direct endpoint that is simply unreachable (Tailscale off, a stale
    // address from pairing) fails every probe for hours. Redialing it every
    // minute costs a 10s socket timeout and radio time each round for no
    // possible gain, so the cooldown doubles per failure up to the ceiling.
    // A resume or a success starts the ladder over.
    const ceiling = this.options.maxFailureCooldownMs ?? this.options.failureCooldownMs
    const doubled =
      this.options.failureCooldownMs * 2 ** Math.min(this.consecutiveDirectFailures - 1, 16)
    this.cooldownUntil = now + Math.min(ceiling, doubled)
  }

  /** The user is back (foreground) or the network changed: probe soon again. */
  resetFailureBackoff(now: number): void {
    this.consecutiveDirectFailures = 0
    this.cooldownUntil = Math.min(this.cooldownUntil, now + this.options.failureCooldownMs)
  }

  recordMigration(now: number): void {
    this.lastMigrationAt = now
    this.consecutiveDirectSuccesses = 0
    this.directObservationStartedAt = null
  }

  canProbe(now: number): boolean {
    return now >= this.cooldownUntil
  }
}
