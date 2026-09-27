import type { ConnectionLogEntry } from '../transport/types'

const HOUR_MS = 3_600_000

/**
 * How long Android kept the app frozen over the span the log covers, from the `app-paused` lines
 * the pause detector writes on waking. Null when there were none.
 *
 * Said even while connected: on 2026-09-27 a report read "Connection is healthy via Relay" and
 * nothing else, while its own history showed the app frozen for an hour at a time all night. A
 * connected state says nothing about that.
 */
export function describeAppPauses(
  entries: readonly ConnectionLogEntry[],
  nowMs: number
): string | null {
  const pauses = new Map<number, number>()
  for (const entry of entries) {
    if (entry.code !== 'app-paused') {
      continue
    }
    const from = pauseStart(entry)
    if (from !== null && from <= entry.ts) {
      // Keyed by when the pause ended, so a pause the log holds twice counts once.
      pauses.set(entry.ts, from)
    }
  }
  if (pauses.size === 0) {
    return null
  }
  const starts = [...pauses.values()]
  const windowStart = Math.min(...entries.map((entry) => entry.ts), ...starts)
  const pausedMs = [...pauses].reduce((total, [to, from]) => total + (to - from), 0)
  const hours = Math.max(1, Math.ceil((nowMs - windowStart) / HOUR_MS))
  const span = hours === 1 ? 'the last hour' : `the last ${hours} hours`
  const count = pauses.size === 1 ? '1 pause' : `${pauses.size} pauses`
  return `Phone was paused by Android for ${formatHoursMinutes(pausedMs)} of ${span} (${count})`
}

/** Where a pause began: the detector writes "(since <ISO>)", and "Nothing ran for 1h 0m" before it. */
function pauseStart(entry: ConnectionLogEntry): number | null {
  const detail = entry.detail ?? ''
  const since = /\(since (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\)/.exec(detail)?.[1]
  const sinceMs = since === undefined ? Number.NaN : Date.parse(since)
  if (!Number.isNaN(sinceMs)) {
    return sinceMs
  }
  const ran = /Nothing ran for (?:(\d+)h )?(\d+)m/.exec(detail)
  if (ran === null) {
    return null
  }
  return entry.ts - (Number(ran[1] ?? 0) * 60 + Number(ran[2])) * 60_000
}

function formatHoursMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
