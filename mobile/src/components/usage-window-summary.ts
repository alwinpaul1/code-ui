import type { UsageWindowKey } from './account-usage-state'

/** Window names as the Claude app's Usage page writes them. */
export function usageWindowTitle(key: UsageWindowKey, long = false): string {
  switch (key) {
    case 'session':
      return long ? 'Current session' : 'Session'
    case 'weekly':
      return long ? 'All models' : 'Weekly'
    case 'fableWeekly':
      return long ? 'Fable only' : 'Fable'
  }
}

/** "Resets in 3 hr 34 min" / "Resets in 7d 0h" — the countdown form. */
export function formatResetCountdown(resetsAt: number, now: number): string {
  const remaining = Math.max(0, resetsAt - now)
  if (remaining === 0) {
    return 'Resets now'
  }
  const totalMinutes = Math.ceil(remaining / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) {
    return `Resets in ${days}d ${hours}h`
  }
  if (hours > 0) {
    return `Resets in ${hours} hr ${minutes} min`
  }
  return `Resets in ${minutes} min`
}
