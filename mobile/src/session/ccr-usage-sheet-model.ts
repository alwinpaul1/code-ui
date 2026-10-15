import type { CcrPlanRow } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import { contextPercent } from './ccr-context-usage'
import { formatTokens } from './context-card-model'

/**
 * The Claude app's Usage sheet (1.261009.20), as text and numbers: "Context", "Plan usage" and
 * "Weekly limits", each a card of meter rows (title, "N% used", bar, caption). The app's own words
 * (res/values/strings.xml): usage_title, usage_context_header, usage_context_window_title,
 * usage_context_window_tokens_caption "%1$s of %2$s tokens", usage_context_window_updated_caption
 * "… · Updated %3$s", usage_context_window_unanswered_caption, usage_plan_usage_header,
 * usage_current_session, usage_weekly_limits, usage_all_models, usage_scoped_label "%1$s only",
 * usage_percent_used "%1$d%% used", usage_resets_in_hours_minutes "Resets in %1$d hr %2$d min",
 * usage_resets_in_minutes "Resets in %1$d min", usage_resets_at "Resets %1$s",
 * usage_meter_row_loading "Loading", usage_load_error, usage_refresh_error.
 *
 * The Context card has no chevron and no breakdown: the user asked for none (2026-10-15).
 */

export const USAGE_SHEET_TEXT = {
  title: 'Usage',
  contextHeader: 'Context',
  contextTitle: 'Context window',
  planHeader: 'Plan usage',
  currentSession: 'Current session',
  weeklyHeader: 'Weekly limits',
  allModels: 'All models',
  loading: 'Loading',
  unanswered: 'The session didn’t respond. Tap the refresh button to try again.',
  loadError: 'Something went wrong loading usage data.',
  refreshError: 'Couldn’t refresh usage'
} as const

export type UsageMeterTone = 'normal' | 'warning' | 'critical'

export type UsageMeterRow = {
  title: string
  /** "36% used", "Loading", or null when no percent is known (a window not stated). */
  figure: string | null
  /** 0..100 for the bar, or null for no bar. */
  percent: number | null
  tone: UsageMeterTone
  caption: string | null
}

/** `v7a`: 90 and up is critical, 75 and up a warning. */
export function usageMeterTone(percent: number): UsageMeterTone {
  return percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'normal'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "6:59 pm", in the phone's own time zone; written out by hand so no locale reorders it. */
export function formatClock(epochMs: number): string {
  const at = new Date(epochMs)
  const hours = at.getHours()
  const minutes = String(at.getMinutes()).padStart(2, '0')
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

/**
 * A plan row's reset line. Within a day: "Resets in 1 hr 38 min" / "Resets in 7 min", the minutes
 * rounded UP so the last minute never reads as already reset; further off: "Resets Wed 6:59 pm".
 * Passed, or not stated: no line. (The app's choice between the two did not decompile; its
 * screenshots show the session row in the first form and the weekly rows in the second.)
 */
export function formatPlanReset(resetsAtSeconds: number | null, nowMs: number): string | null {
  if (resetsAtSeconds === null) {
    return null
  }
  const seconds = resetsAtSeconds - nowMs / 1000
  if (seconds <= 0) {
    return null
  }
  if (seconds < 24 * 3600) {
    const total = Math.ceil(seconds / 60)
    const hours = Math.floor(total / 60)
    const minutes = total % 60
    return hours > 0 ? `Resets in ${hours} hr ${minutes} min` : `Resets in ${minutes} min`
  }
  const at = new Date(resetsAtSeconds * 1000)
  return `Resets ${DAYS[at.getDay()]} ${formatClock(resetsAtSeconds * 1000)}`
}

/** A figure the phone already had before asking: a live answer from an earlier turn, or what the
 *  ring shows (the session row's own statement, the beacon). */
export type UsageContextFigure = {
  usedTokens: number | null
  windowTokens: number | null
  /** Labels when only labels are known (the beacon states "128k" and "400k", not counts). */
  usedLabel?: string | null
  windowLabel?: string | null
  percent: number | null
  /** When it was taken, for "· Updated <time>"; null when it is the session's current statement. */
  updatedAt: number | null
}

export type UsageContextState = {
  /** The answer to this sheet's own ask, for the current turn. */
  answer: { usedTokens: number; windowTokens: number; percent: number } | null
  /** The best figure known otherwise. */
  figure: UsageContextFigure | null
  ask: 'idle' | 'asking' | 'unanswered'
}

/** The Context card's one row. */
export function contextMeterRow(state: UsageContextState): UsageMeterRow {
  const title = USAGE_SHEET_TEXT.contextTitle
  if (state.answer) {
    const { usedTokens, windowTokens, percent } = state.answer
    return { title, figure: `${percent}% used`, percent, tone: usageMeterTone(percent), caption: `${formatTokens(usedTokens)} of ${formatTokens(windowTokens)} tokens` }
  }
  const figure = state.figure
  const usedLabel = figure ? (figure.usedTokens !== null ? formatTokens(figure.usedTokens) : (figure.usedLabel ?? null)) : null
  const windowLabel = figure ? (figure.windowTokens !== null && figure.windowTokens > 0 ? formatTokens(figure.windowTokens) : (figure.windowLabel ?? null)) : null
  const percent =
    figure === null
      ? null
      : figure.percent !== null
        ? Math.max(0, Math.min(100, Math.round(figure.percent)))
        : figure.usedTokens !== null && figure.windowTokens !== null && figure.windowTokens > 0
          ? contextPercent(figure.usedTokens, figure.windowTokens)
          : null
  if (state.ask === 'unanswered') {
    return { title, figure: percent !== null ? `${percent}% used` : null, percent, tone: usageMeterTone(percent ?? 0), caption: USAGE_SHEET_TEXT.unanswered }
  }
  if (figure !== null && usedLabel === null && percent !== null) {
    // A percent with no counts (the status line's bare figure): the bar, and no token line.
    return { title, figure: `${percent}% used`, percent, tone: usageMeterTone(percent), caption: null }
  }
  if (figure === null || usedLabel === null) {
    return { title, figure: state.ask === 'asking' ? USAGE_SHEET_TEXT.loading : null, percent: null, tone: 'normal', caption: null }
  }
  // No window stated: the tokens alone, no percent, no bar (CLAUDE.md: never invent a denominator).
  const tokens = windowLabel !== null ? `${usedLabel} of ${windowLabel} tokens` : `${usedLabel} tokens`
  const caption = figure.updatedAt !== null ? `${tokens} · Updated ${formatClock(figure.updatedAt)}` : tokens
  return { title, figure: percent !== null && windowLabel !== null ? `${percent}% used` : null, percent: windowLabel !== null ? percent : null, tone: usageMeterTone(percent ?? 0), caption }
}

/**
 * Which account the sheet's plan figures belong to: the account the tab's own session runs under,
 * the one a send would use (`ccrSendTargetForTab`). Before the match lands, the account its Claude
 * config dir is bound to. A profile not known, a match under another account, or one not settled:
 * none, and the plan cards stay "Loading" rather than show another account's numbers.
 */
export function usageSheetAccount(target: CcrSendTarget, boundAccountId: string | null): string | null {
  if (target.kind === 'target') {
    return target.accountId
  }
  return target.reason === 'unmatched' ? boundAccountId : null
}

export type UsagePlanState = {
  /** The rows of the sheet's account, or null when none were read for it. */
  rows: readonly CcrPlanRow[] | null
  /** A read for this account failed (and `rows` is what an earlier read left, if anything). */
  failed: boolean
}

export type UsagePlanCards = {
  session: UsageMeterRow[]
  weekly: UsageMeterRow[]
  /** "Something went wrong loading usage data." when nothing could be read; null otherwise. */
  error: string | null
  /** "Couldn’t refresh usage" when a refresh failed over rows already shown. */
  refreshError: string | null
}

const LOADING_ROW = (title: string): UsageMeterRow => ({ title, figure: USAGE_SHEET_TEXT.loading, percent: null, tone: 'normal', caption: null })

export function planCards(plan: UsagePlanState | null, nowMs: number): UsagePlanCards {
  if (plan === null || (plan.rows === null && !plan.failed)) {
    return { session: [LOADING_ROW(USAGE_SHEET_TEXT.currentSession)], weekly: [LOADING_ROW(USAGE_SHEET_TEXT.allModels)], error: null, refreshError: null }
  }
  if (plan.rows === null) {
    return { session: [], weekly: [], error: USAGE_SHEET_TEXT.loadError, refreshError: null }
  }
  const meter = (row: CcrPlanRow): UsageMeterRow => ({
    title: row.kind === 'session' ? USAGE_SHEET_TEXT.currentSession : row.kind === 'weekly_all' ? USAGE_SHEET_TEXT.allModels : `${row.modelName} only`,
    figure: `${row.percent}% used`,
    percent: row.percent,
    tone: usageMeterTone(row.percent),
    caption: formatPlanReset(row.resetsAt, nowMs)
  })
  return {
    session: plan.rows.filter((row) => row.kind === 'session').map(meter),
    weekly: plan.rows.filter((row) => row.kind !== 'session').map(meter),
    error: null,
    refreshError: plan.failed ? USAGE_SHEET_TEXT.refreshError : null
  }
}
