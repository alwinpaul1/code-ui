import {
  getUsageBarState,
  getVisibleUsageWindows,
  getWindowResetLabel,
  type ProviderRateLimits,
  type UsageWindowKey
} from './account-usage-state'

export function usageWindowTitle(key: UsageWindowKey, long = false): string {
  switch (key) {
    case 'session':
      return long ? 'Current session' : 'Session'
    case 'weekly':
      return long ? 'Weekly · all models' : 'Weekly'
    case 'fableWeekly':
      return long ? 'Weekly · Fable' : 'Fable'
  }
}

export type UsageHeadline = {
  key: UsageWindowKey
  title: string
  usedPercent: number | null
  resetLabel: string | null
  loading: boolean
  unavailable: boolean
}

/**
 * The window worth leading with: the most-used one, since that is the limit
 * the user will hit first (the way Copilot leads with "216 / 1,500 credits").
 * Falls back to the first visible window while nothing has data yet.
 */
export function getUsageHeadline(
  limits: ProviderRateLimits | null,
  now: number,
  isFetching?: boolean
): UsageHeadline | null {
  const keys = getVisibleUsageWindows(limits, isFetching)
  if (keys.length === 0) {
    return null
  }
  let best: UsageWindowKey = keys[0]!
  let bestUsed = -1
  for (const key of keys) {
    const used = getUsageBarState(limits, key, isFetching).usedPercent
    if (used != null && used > bestUsed) {
      best = key
      bestUsed = used
    }
  }
  const state = getUsageBarState(limits, best, isFetching)
  return {
    key: best,
    title: usageWindowTitle(best),
    usedPercent: state.usedPercent,
    resetLabel: getWindowResetLabel(limits, best, now),
    loading: state.loading,
    unavailable: state.unavailable
  }
}

/** Same bands as the desktop status bar: calm below 60, amber below 80, red from 80. */
export function usageTone(usedPercent: number | null): 'success' | 'warning' | 'danger' | 'muted' {
  if (usedPercent == null) {
    return 'muted'
  }
  if (usedPercent >= 80) {
    return 'danger'
  }
  if (usedPercent >= 60) {
    return 'warning'
  }
  return 'success'
}
