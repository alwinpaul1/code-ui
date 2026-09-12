import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** A pause this long between two messages earns a divider before the later
 *  one, as in the Claude app (2026-09-13: a wavy rule with "Friday 8:29 pm"
 *  between an answer and the 401 that came after a break). */
export const CHAT_TIME_DIVIDER_GAP_MS = 20 * 60_000

/** Which messages open after a pause, and what the rule above them says.
 *  Oldest-first input. The first message of a transcript gets none: there
 *  is nothing before it to have paused from. A message without a timestamp
 *  neither earns a divider nor moves the clock. */
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
    if (previous !== null && at - previous >= gapMs) {
      labels.set(message.id, formatChatDividerTime(at, now))
    }
    previous = at
  }
  return labels
}

/** "8:29 pm" today, "Friday 8:29 pm" within the week, else "12 Sep 8:29 pm"
 *  (with the year once it differs). Local time, like the Claude app. */
export function formatChatDividerTime(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  const time = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  const clock = time.replace(/\s?(am|pm)/i, (_m, ampm: string) => ` ${ampm.toLowerCase()}`)
  if (sameDay(date, today)) {
    return clock
  }
  if (now - at < 6 * 86_400_000) {
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
