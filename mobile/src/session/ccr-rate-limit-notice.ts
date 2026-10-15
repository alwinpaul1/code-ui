import type { CcrRateLimitState } from './ccr-live-state'
import { formatRateLimitResets, RATE_LIMIT_TITLES, RATE_LIMIT_TRY_AGAIN_LATER, type RateLimitNotice } from './hud-rate-limit-notice'

/**
 * The limit banner's notice from a matched session's NEWEST `rate_limit_event` (ccr-live-state.ts
 * `rateLimit`): the server's own call, which the Claude app draws (a430.java:881-897, pj8.java:
 * 121-194). When it is present it decides; when it is not, the banner keeps its thresholds over the
 * beacon and the host feed (hud-rate-limit-notice.ts `rateLimitNotice`).
 *
 *  - `undefined`: no event, or the event's reset has passed. Nothing is stated about now: fall back.
 *  - `null`: the server says the account is clear (`allowed`, or a warning with no reset). No banner,
 *    whatever a threshold would say.
 *  - a notice: `rejected` is "Limit reached" (or "Now using usage credits" with `isUsingOverage`),
 *    `allowed_warning` is "Approaching limit".
 *
 * The keys are the threshold path's (`reached:session:<minute>` and so on), so a dismissal made on
 * one source holds on the other for the same window and reset.
 */
export function ccrRateLimitNotice(state: CcrRateLimitState | null | undefined, now: number): RateLimitNotice | null | undefined {
  if (!state) {
    return undefined
  }
  const nowSeconds = Math.floor(now / 1000)
  if (state.resetsAt !== null && state.resetsAt <= nowSeconds) {
    return undefined
  }
  const window = state.rateLimitType === 'five_hour' ? 'session' : state.rateLimitType === 'seven_day' ? 'weekly' : (state.rateLimitType ?? 'unknown')
  const cycle = state.resetsAt === null ? 'none' : String(Math.round(state.resetsAt / 60))
  const subtitle = state.resetsAt === null ? RATE_LIMIT_TRY_AGAIN_LATER : formatRateLimitResets(state.resetsAt, now)
  switch (state.kind) {
    case 'reached':
      return state.isUsingOverage
        ? { kind: 'credits', title: RATE_LIMIT_TITLES.credits, subtitle: null, dismissible: true, key: 'credits' }
        : { kind: 'reached', title: RATE_LIMIT_TITLES.reached, subtitle, dismissible: false, key: `reached:${window}:${cycle}` }
    case 'approaching':
      return { kind: 'approaching', title: RATE_LIMIT_TITLES.approaching, subtitle, dismissible: true, key: `approaching:${window}:${cycle}` }
    case 'clear':
      return null
    default: {
      const unhandled: never = state.kind
      return unhandled
    }
  }
}
