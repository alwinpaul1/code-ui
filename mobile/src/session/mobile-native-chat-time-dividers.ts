import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** A pause longer than this earns a header above the later message, as in
 *  the Claude app (1.261013.20, `jcz.a`: strictly more than one hour). */
export const CHAT_TIME_DIVIDER_GAP_MS = 60 * 60_000

/** Which messages get a time header above them, and what it says, by the
 *  Claude app's rule (`jcz.a`): the first message, the first of a new calendar
 *  day, and one that came more than an hour after the message before it.
 *  Oldest-first input. A message without a timestamp neither earns a header
 *  nor moves the clock. */
export function chatTimeDividerLabels(
  messages: readonly NativeChatMessage[],
  now: number,
  gapMs = CHAT_TIME_DIVIDER_GAP_MS
): Map<string, string> {
  const labels = new Map<string, string>()
  let previous: number | null = null
  for (const message of messages) {
    const at = message.timestamp
    if (at === null || at === undefined) {
      continue
    }
    if (previous === null || !sameDay(new Date(at), new Date(previous)) || at - previous > gapMs) {
      labels.set(message.id, formatChatDividerTime(at, now))
    }
    previous = at
  }
  return labels
}

/** "8:29 pm" today, "Friday 8:29 pm" within the last seven calendar days,
 *  else "12 Aug 8:29 pm" (with the year once it differs). Local time, like the
 *  Claude app. */
export function formatChatDividerTime(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  const time = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  const clock = time.replace(/\s?(am|pm)/i, (_m, ampm: string) => ` ${ampm.toLowerCase()}`)
  if (sameDay(date, today)) {
    return clock
  }
  // The weekday while the day is within the last seven calendar days (the
  // app's `ad00.b`: the date is after today minus seven days).
  const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
  if (startOfDay(date) > weekAgo.getTime()) {
    return `${date.toLocaleDateString('en-GB', { weekday: 'long' })} ${clock}`
  }
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
  })
  return `${day} ${clock}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
