import { notificationPlainText } from './notification-plain-text'
import type { DesktopNotificationSource } from './notification-routing'

export type PresentedNotification = { title: string; body: string }

/** Longest body Android shows expanded before it truncates on its own. */
const BODY_LIMIT = 320

/**
 * The desktop sends "<repo> / <worktree> - <Agent> <what happened>" as the
 * title and the agent's full Markdown summary as the body. Re-shape that the
 * way a modern app would: the event first ("Claude finished · Code UI"), then
 * a short summary that keeps its emphasis but loses the markup. A worktree
 * named after its repo is said once, not twice.
 */
export function presentDesktopNotification(event: {
  source: DesktopNotificationSource
  title: string
  body: string
}): PresentedNotification {
  const parsed = parseDesktopTitle(event.title)
  const title = parsed
    ? parsed.location
      ? `${parsed.headline} · ${parsed.location}`
      : parsed.headline
    : notificationPlainText(event.title)
  const summary = summarize(event.body, parsed?.headline)
  return { title, body: summary }
}

function parseDesktopTitle(title: string): { headline: string; location: string } | null {
  const match = /^(.*?)\s+[-–—]\s+([^-–—]+)$/.exec(title.trim())
  if (!match) {
    return null
  }
  const headline = match[2]!.trim()
  const segments = match[1]!
    .split(/\s+\/\s+/)
    .map((segment) => segment.trim())
    .filter((segment, index, all) => segment !== '' && all.indexOf(segment) === index)
  return { headline, location: segments.join(' / ') }
}

function summarize(body: string, headline: string | undefined): string {
  const text = notificationPlainText(body)
  if (text === '') {
    return ''
  }
  // "Claude finished." as the body of "Claude finished" says nothing twice.
  if (headline && text.replace(/[.!]$/, '').toLowerCase() === headline.toLowerCase()) {
    return ''
  }
  if (text.length <= BODY_LIMIT) {
    return text
  }
  const cut = text.slice(0, BODY_LIMIT)
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('\n\n'))
  const end = sentenceEnd > BODY_LIMIT / 2 ? sentenceEnd + 1 : cut.lastIndexOf(' ')
  return `${cut.slice(0, end > 0 ? end : BODY_LIMIT).trimEnd()}…`
}
