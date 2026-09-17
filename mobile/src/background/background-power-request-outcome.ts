/**
 * Whether the exemption a user asked for actually arrived.
 *
 * Tapping Allow fires ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which on many
 * Android builds opens the optimisation LIST rather than a yes/no dialog. The
 * reader lands in a settings screen, does not find the app, backs out — and it
 * feels exactly like having allowed. Nothing checked afterwards, so the grant
 * silently failed and the only sign was the same prompt returning a fortnight
 * later (reported 2026-09-18 as "it also appeared for people who allowed too").
 *
 * The app cannot make the grant happen. It can stop pretending it did.
 */
export type BackgroundPowerRequestOutcome = 'none' | 'granted' | 'not-taken'

/**
 * How long after opening the system screen a return still counts as an answer.
 *
 * The marker outlives the trip, so without a bound someone who got distracted
 * and came back tomorrow would be told their request failed — a stale marker
 * read as an outcome. Generous enough to survive hunting through a settings
 * list, short enough that it is still the same errand.
 */
export const BACKGROUND_POWER_REQUEST_WINDOW_MS = 10 * 60 * 1000

export function adviseBackgroundPowerRequestOutcome(state: {
  /** Milliseconds since the system screen was opened, or null if it was not. */
  requestedAgo: number | null
  unrestricted: boolean
}): BackgroundPowerRequestOutcome {
  if (state.requestedAgo === null) {
    return 'none'
  }
  // Good news is worth reporting however late, and the marker wants clearing
  // either way.
  if (state.unrestricted) {
    return 'granted'
  }
  // A negative age means the clock moved backwards. Reporting a failure on the
  // strength of that would be inventing an outcome nobody produced.
  if (state.requestedAgo < 0 || state.requestedAgo > BACKGROUND_POWER_REQUEST_WINDOW_MS) {
    return 'none'
  }
  return 'not-taken'
}
