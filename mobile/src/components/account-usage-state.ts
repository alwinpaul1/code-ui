// Why: keep these shapes in lockstep with src/shared/types.ts and
// src/shared/rate-limit-types.ts. We don't import from desktop here because
// the mobile bundle must not pull in Electron-coupled type files.
//
// Pure state/selectors live here (no React Native imports) so they can be
// unit-tested directly; AccountUsage.tsx re-exports them alongside the
// UsageBar component.
import { formatResetCountdown } from '../../../src/shared/rate-limit-reset-format'
import type {
  AccountsSnapshot,
  InactiveAccountUsage,
  ProviderRateLimits
} from './accounts-snapshot'

export {
  AccountsSnapshotSchema,
  decodeAccountsSnapshot,
  ProviderRateLimitsSchema,
  RateLimitRuntimeTargetSchema,
  type AccountsSnapshot,
  type ClaudeAccountSummary,
  type CodexAccountSummary,
  type InactiveAccountUsage,
  type ProviderRateLimits,
  type RateLimitRuntimeTarget,
  type RateLimitWindow
} from './accounts-snapshot'

export type ProviderKey = 'claude' | 'codex'

export type UsageBarState = {
  usedPercent: number | null
  unavailable: boolean
  loading: boolean
}

export function getActiveProviderRateLimits(
  snapshot: AccountsSnapshot,
  provider: ProviderKey
): ProviderRateLimits | null {
  return provider === 'claude' ? snapshot.rateLimits.claude : snapshot.rateLimits.codex
}

export function getInactiveProviderUsage(
  snapshot: AccountsSnapshot,
  provider: ProviderKey,
  accountId: string
): InactiveAccountUsage | null {
  const list =
    provider === 'claude'
      ? snapshot.rateLimits.inactiveClaudeAccounts
      : snapshot.rateLimits.inactiveCodexAccounts
  return list.find((u) => u.accountId === accountId) ?? null
}

// Why: rate limits are fetched for the active target even when no Orca-managed
// account exists (the default target is the agent's own system-default login).
// Treat a provider as having usage worth showing when a fetch succeeded or any
// window has data; an unavailable/error provider with no windows means the
// system-default login has no credentials for it, so there is nothing to show.
export function hasActiveProviderUsage(limits: ProviderRateLimits | null): boolean {
  if (!limits) {
    return false
  }
  if (
    limits.session != null ||
    limits.weekly != null ||
    limits.monthly != null ||
    (limits.buckets && limits.buckets.length > 0)
  ) {
    return true
  }
  return limits.status === 'ok'
}

// Why: transient errors keep the last successful window data, so availability
// is per window rather than per provider status.
export function getUsageBarState(
  limits: ProviderRateLimits | null,
  windowKey: 'session' | 'weekly',
  isFetchingOverride?: boolean
): UsageBarState {
  const window = limits?.[windowKey] ?? null
  const fetching =
    isFetchingOverride ?? (limits?.status === 'fetching' || limits?.status === 'idle')
  return {
    usedPercent: window?.usedPercent ?? null,
    unavailable: window == null && !fetching,
    loading: fetching && window == null
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "5:30 AM" in the device's time zone. */
export function formatResetClock(resetsAt: number): string {
  const date = new Date(resetsAt)
  const hours24 = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${minutes} ${hours24 < 12 ? 'AM' : 'PM'}`
}

/**
 * Reset label for one window, or null when the window has no reset timestamp
 * (so the UI degrades to today's bars-only layout).
 *
 * Session (5h): the countdown plus the clock time it lands on — "Resets in
 * 1h 14m · 5:30 AM". Weekly (7d): the weekday and time — "Resets Wed 7:00 PM",
 * which is how the desktop status line names it; a "4d 14h" countdown told
 * nobody which evening that was. `now` is a parameter so this stays pure.
 */
export function getWindowResetLabel(
  limits: ProviderRateLimits | null,
  windowKey: 'session' | 'weekly',
  now: number
): string | null {
  const resetsAt = limits?.[windowKey]?.resetsAt
  if (resetsAt == null) {
    return null
  }
  if (windowKey === 'weekly') {
    if (resetsAt <= now) {
      return 'Resets now'
    }
    return `Resets ${WEEKDAYS[new Date(resetsAt).getDay()]} ${formatResetClock(resetsAt)}`
  }
  // Why a line break: the two bars share one row on the phone, and "Resets in
  // 1h 2m · 5:30 AM" does not fit half of it; the clock goes on its own line.
  const countdown = formatResetCountdown(resetsAt - now)
  return countdown === 'Resets now' ? countdown : `${countdown}\n${formatResetClock(resetsAt)}`
}

// Why: the usage UI must render for the system-default login, not only for
// Orca-managed accounts. Show a provider when it has at least one managed
// account OR active rate-limit data for the system-default target.
export function hasRenderableUsage(snapshot: AccountsSnapshot, provider: ProviderKey): boolean {
  const accounts = provider === 'claude' ? snapshot.claude.accounts : snapshot.codex.accounts
  if (accounts.length > 0) {
    return true
  }
  return hasActiveProviderUsage(getActiveProviderRateLimits(snapshot, provider))
}
