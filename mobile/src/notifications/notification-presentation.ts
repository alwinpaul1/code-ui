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
const AGENT_HEADLINE_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  openclaude: 'OpenClaude',
  codex: 'Codex',
  grok: 'Grok',
  omp: 'OMP',
  gemini: 'Gemini',
  cursor: 'Cursor',
  aider: 'Aider',
  pi: 'Pi',
  droid: 'Droid',
  hermes: 'Hermes',
  antigravity: 'Antigravity',
  opencode: 'OpenCode'
}

const AGENT_HEADLINE_NAMES = 'Claude|OpenClaude|Codex|Grok|OMP|Gemini|Cursor|Aider|Pi|Droid|Hermes|Antigravity|OpenCode'

/** Desktop titles the event from hook `agentType`. Grok does not write that
 *  hook; the host then says Claude. When the worktree's only launched agent is
 *  known, put that name on the headline. */
export function headlineWithKnownAgent(headline: string, agent: string | null | undefined): string {
  if (!agent) {
    return headline
  }
  const label = AGENT_HEADLINE_LABELS[agent] ?? null
  if (!label) {
    return headline
  }
  return headline.replace(new RegExp(`^(${AGENT_HEADLINE_NAMES})\\b`, 'i'), label)
}

export function presentDesktopNotification(event: {
  source: DesktopNotificationSource
  title: string
  body: string
  agent?: string | null
}): PresentedNotification {
  const parsed = parseDesktopTitle(event.title)
  const headline = headlineWithKnownAgent(
    parsed?.headline ?? notificationPlainText(event.title),
    event.agent
  )
  const glyph = statusGlyph(event.source, headline)
  const title = parsed?.location ? `${glyph}${headline} · ${parsed.location}` : `${glyph}${headline}`
  const summary = summarize(event.body, parsed?.headline)
  return { title, body: summary }
}

/**
 * One glyph up front says what happened before a word is read, the way a
 * status bot does: done, waiting on you, or a plain bell. Nothing else in the
 * title gets an emoji.
 */
function statusGlyph(source: DesktopNotificationSource, headline: string): string {
  const text = headline.toLowerCase()
  if (/\b(needs?|waiting|approve|permission|question|input)\b/.test(text)) {
    return '❓ '
  }
  if (source === 'terminal-bell') {
    return '🔔 '
  }
  if (/\b(finished|done|complete[d]?)\b/.test(text)) {
    return '✅ '
  }
  return ''
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
