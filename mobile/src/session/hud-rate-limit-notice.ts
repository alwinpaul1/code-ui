import type { ProviderRateLimits } from '../components/accounts-snapshot'
import type { AgentHudBeacon } from './agent-hud-beacon'
import { hudLimitsFromRateLimits } from './hud-rate-limits'

/**
 * The Claude app's rate-limit banner (com.anthropic.claude 1.261009.20, `pj8.b`, `bb8` case 4):
 * which notice, if any, the usage windows say to draw, and what it says.
 *
 * WHERE THE FIGURES COME FROM (decided 2026-10-14, Batch 5)
 *
 *  1. The HUD beacon. Claude Code's status-line payload already carries
 *     `rate_limits.five_hour` and `.seven_day` (`used_percentage`, `resets_at` in epoch seconds), and
 *     the launch script has written them as `h5=` and `d7=` since the HUD began
 *     (agent-hud-launch-args.ts; docs/mobile-agent-hud.md "The payload"). They are read, not added:
 *     no beacon field is new, so the frame-size and splice rules are untouched. It is the agent's own
 *     statement about this session, repainted on every status-line beat, so it outranks the host feed.
 *  2. The host's `accounts.subscribe` windows (hud-rate-limits.ts), for the agents whose beacon has no
 *     limits: Codex (its notify beacon carries tokens and a window, never a limit), and a Claude tab
 *     with no beacon yet or whose payload held no `rate_limits` (an API-key session, or one that has
 *     not had its first reply).
 *  3. Not used: the Anthropic sessions API's `rate_limit_event`. It is the only source of "now using
 *     usage credits" (`isUsingOverage`) and of the server's own `allowed_warning` word, but it exists
 *     only for a session registered with Anthropic, which a local tab usually is not. Batch 8 owns it.
 *     Until it lands the credits variant below has no live source and is never drawn.
 *
 * No window, no notice: a reading the agent did not state is never invented.
 *
 * WHEN A WINDOW COUNTS AS "APPROACHING". The Claude app takes the word from the server. Neither
 * source here carries it, so each agent's own rule is used, read from the agent and not guessed:
 *
 *  - Claude Code 2.1.296 (its binary, `Zw` and `Mm`): a warning is computed when a window's use passes
 *    a tier while the share of the window already gone is at or under the tier's time limit. The
 *    5-hour window (18,000 s) has one tier, 90% by 72% of the time. The 7-day window (604,800 s) has
 *    three, 75% by 60%, 50% by 35% and 25% by 15%. Claude Code then shows only a warning whose use is
 *    at least 70% (`Sm`), so the two lower weekly tiers never reach the screen, and neither do they
 *    reach this one.
 *  - Codex 0.153.4 (codex-rs `tui/src/chatwidget/rate_limits.rs`, tag rust-v0.153.4):
 *    `RATE_LIMIT_WARNING_THRESHOLDS = [50, 75, 90, 95]` percent used, the 50 only for a Plus or Team
 *    plan's 5-hour window. 75 is the first tier for every plan, so a window is "approaching" from 75%.
 *
 * "REACHED" is the same for both: 100%. Codex's own check is `percent == 100.0`, and Claude Code's
 * status line states 100 once it has refused a request.
 *
 * A window whose reset has passed is not read: the figure is the last one the agent saw, and the
 * agent's own docs say to expire anything built from it by `resetsAt`.
 *
 * Not read for either state: the Fable window. It is one model's own limit, and nothing here says
 * the running session uses that model.
 */

export type RateLimitWindowReading = {
  /** "Session" (5-hour) or "Weekly", as `hudLimitsFromRateLimits` and the beacon name them. */
  name?: string
  usedPercent: number
  windowMinutes: number | null
  /** Epoch SECONDS, or null when the agent stated none. */
  resetsAt: number | null
}

export type RateLimitNoticeKind = 'approaching' | 'reached' | 'credits'

export type RateLimitNotice = {
  kind: RateLimitNoticeKind
  title: string
  /** "Resets Friday at 9:05 am", "Resets at 6:20 pm", or "Try again later"; null for credits. */
  subtitle: string | null
  /** The Claude app closes an approaching notice and the credits one, never a limit reached
   *  (`qb20.m`). */
  dismissible: boolean
  /** The same notice for as long as this holds: a different kind, window or reset cycle is a new
   *  one, which a dismissal made for the old one does not cover. */
  key: string
}

// The strings as the Claude app ships them (`ccr_rate_limit_approaching_title`,
// `rate_limit_reached`, `ccr_rate_limit_usage_credits_title`, `rate_limit_try_again_later`).
export const RATE_LIMIT_TITLES = {
  approaching: 'Approaching limit',
  reached: 'Limit reached',
  credits: 'Now using usage credits'
} as const satisfies Record<RateLimitNoticeKind, string>
export const RATE_LIMIT_TRY_AGAIN_LATER = 'Try again later'

type WindowKind = 'session' | 'weekly'

const SESSION_SECONDS = 18_000
const WEEKLY_SECONDS = 604_800

/** Claude Code 2.1.296's `Zw`, in percent. Each tier: use at least `used`, with at most `timeShare`
 *  of the window gone. */
const CLAUDE_EARLY_WARNING: Record<WindowKind, { seconds: number; tiers: { used: number; timeShare: number }[] }> = {
  session: { seconds: SESSION_SECONDS, tiers: [{ used: 90, timeShare: 0.72 }] },
  weekly: {
    seconds: WEEKLY_SECONDS,
    tiers: [
      { used: 75, timeShare: 0.6 },
      { used: 50, timeShare: 0.35 },
      { used: 25, timeShare: 0.15 }
    ]
  }
}
/** Claude Code 2.1.296's `Sm`: it shows no warning whose use is under this. */
const CLAUDE_WARNING_FLOOR = 70
/** Codex's first warning tier that holds for every plan. */
const CODEX_APPROACHING_PERCENT = 75

function windowKind(reading: RateLimitWindowReading): WindowKind | null {
  // A window the host names for itself ("Fable") is not the session's or the week's.
  if (reading.name !== undefined && reading.name !== 'Session' && reading.name !== 'Weekly') {
    return null
  }
  const minutes = reading.windowMinutes
  if (minutes !== null) {
    // Codex's own tolerance (`is_approximate_window`): within 5% of the length.
    if (minutes >= 300 * 0.95 && minutes <= 300 * 1.05) {
      return 'session'
    }
    if (minutes >= 10_080 * 0.95 && minutes <= 10_080 * 1.05) {
      return 'weekly'
    }
    return null
  }
  if (reading.name === 'Session') {
    return 'session'
  }
  return reading.name === 'Weekly' ? 'weekly' : null
}

/** The share of the window gone, 0 to 1, as Claude Code's `eS` takes it. */
function timeShareGone(resetsAt: number, windowSeconds: number, nowSeconds: number): number {
  return Math.max(0, Math.min(1, (nowSeconds - (resetsAt - windowSeconds)) / windowSeconds))
}

function claudeApproaching(kind: WindowKind, used: number, resetsAt: number | null, nowSeconds: number): boolean {
  if (resetsAt === null || used < CLAUDE_WARNING_FLOOR) {
    return false
  }
  const rule = CLAUDE_EARLY_WARNING[kind]
  const gone = timeShareGone(resetsAt, rule.seconds, nowSeconds)
  return rule.tiers.some((tier) => used >= tier.used && gone <= tier.timeShare)
}

function isClaude(agent: string | null): boolean {
  return agent === 'claude' || agent === 'openclaude'
}

/** The words after "Resets": the clock alone for a reset today, the weekday and the clock for any
 *  other day, as `urq.h` and `pj8.b` build them. The clock is the Code UI convention
 *  (mobile-native-chat-time-dividers.ts): English, 12-hour, "6:20 pm". */
export function formatRateLimitResets(resetsAt: number, now: number): string {
  const date = new Date(resetsAt * 1000)
  const today = new Date(now)
  const clock = date
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?(am|pm)/i, (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`)
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay
    ? `Resets at ${clock}`
    : `Resets ${date.toLocaleDateString('en-GB', { weekday: 'long' })} at ${clock}`
}

function subtitleFor(resetsAt: number | null, now: number): string {
  return resetsAt === null ? RATE_LIMIT_TRY_AGAIN_LATER : formatRateLimitResets(resetsAt, now)
}

export function rateLimitNotice(input: {
  windows: readonly RateLimitWindowReading[] | null | undefined
  agent: string | null
  now: number
  /** True only when a source states the account is spending usage credits; none does yet. */
  usingCredits?: boolean
}): RateLimitNotice | null {
  const { agent, now } = input
  if (input.usingCredits === true) {
    return { kind: 'credits', title: RATE_LIMIT_TITLES.credits, subtitle: null, dismissible: true, key: 'credits' }
  }
  const nowSeconds = Math.floor(now / 1000)
  const live = (input.windows ?? [])
    .map((reading) => ({ reading, kind: windowKind(reading) }))
    .filter(
      (entry): entry is { reading: RateLimitWindowReading; kind: WindowKind } =>
        entry.kind !== null &&
        Number.isFinite(entry.reading.usedPercent) &&
        (entry.reading.resetsAt === null || entry.reading.resetsAt > nowSeconds)
    )
  // A limit reached outranks one that is only close. Of two full windows the one that resets last is
  // the one still blocking when the other lifts, and a window with no stated reset says "later".
  const full = live.filter((entry) => entry.reading.usedPercent >= 100)
  if (full.length > 0) {
    const binding = full.reduce((latest, entry) => {
      if (latest.reading.resetsAt === null) {
        return latest
      }
      if (entry.reading.resetsAt === null) {
        return entry
      }
      return entry.reading.resetsAt > latest.reading.resetsAt ? entry : latest
    })
    return {
      kind: 'reached',
      title: RATE_LIMIT_TITLES.reached,
      subtitle: subtitleFor(binding.reading.resetsAt, now),
      dismissible: false,
      key: `reached:${binding.kind}:${binding.reading.resetsAt ?? 'none'}`
    }
  }
  const close = live
    .filter((entry) =>
      isClaude(agent)
        ? claudeApproaching(entry.kind, entry.reading.usedPercent, entry.reading.resetsAt, nowSeconds)
        : agent === 'codex' && entry.reading.usedPercent >= CODEX_APPROACHING_PERCENT
    )
    .sort((a, b) => b.reading.usedPercent - a.reading.usedPercent)[0]
  if (!close) {
    return null
  }
  return {
    kind: 'approaching',
    title: RATE_LIMIT_TITLES.approaching,
    subtitle: subtitleFor(close.reading.resetsAt, now),
    dismissible: true,
    key: `approaching:${close.kind}:${close.reading.resetsAt ?? 'none'}`
  }
}

/** The windows a notice reads: the beacon's when it states any, else the host feed's. */
export function hudRateLimitWindows(
  beacon: AgentHudBeacon | null,
  accounts: ProviderRateLimits | null
): RateLimitWindowReading[] {
  if (beacon && beacon.limits.length > 0) {
    return beacon.limits.map((limit) => ({ ...limit, windowMinutes: null }))
  }
  return hudLimitsFromRateLimits(accounts).map((row) => ({ ...row }))
}
