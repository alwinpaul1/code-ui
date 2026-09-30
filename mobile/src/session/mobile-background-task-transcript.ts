import { cutWholeCharacters } from '../text/whole-character-cut'
import type { BackgroundTaskKind } from './mobile-background-tasks'
import { readWorkflowLaunch, readWorkflowUsage, type WorkflowDetail, type WorkflowUsage } from './mobile-background-task-workflows'

// The transcript-reading half of the background-task reader: the exact
// sentences Claude Code writes when it launches a shell, a subagent or a
// monitor, and the notification it writes when one finishes. Split from the
// reader so each stays under the line ceiling; nothing here knows about the
// host or the beacons.

// Exact sentences from the tool results. The id stops at the first `.` or `)`
// because none of the id alphabets include one.
// Anchored to the start of the result: a command whose OUTPUT merely quotes
// these strings (a grep for them, a printed fixture) is not a launch.
// Reviewed 2026-09-11 — this session's own greps had counted as shells.
// Claude Code 2.1.283 has a second shape behind the server flag
// `tengu_violin_rosin` (switched off in 2.1.282, whose gate always returns
// false). On 2026-09-26 the two configs in use cache it false, but a stale
// ~/.claude/.claude.json from 2026-09-17 holds true, so it has been served to
// one of this machine's accounts. The whole result is then JSON,
// `{"resultType":"task","taskId":…,"status":"working","statusMessage":…}`
// with these sentences inside `statusMessage`, and the finish can reach Claude
// as a tool result instead of a <task-notification>. Neither is read: no real
// record of either exists yet, and a launch read without its finish would pile
// up running shells again.
const SHELL_STARTED = /^\s*Command running in background with ID:\s*([A-Za-z0-9_-]+)/
const SHELL_MOVED = /^\s*Command did not complete[^\n]{0,120}?moved to the background \(ID:\s*([A-Za-z0-9_-]+)\)/
// ctrl+b on a running command (Claude Code 2.1.270, 2026-09-13): a third
// shape, which left the desk at 4 shells and the phone at 2.
const SHELL_BACKGROUNDED = /^\s*Command was manually backgrounded by user with ID:\s*([A-Za-z0-9_-]+)/
// A command moved aside so a message queued while it ran (a phone send
// mid-turn) can reach Claude: the fourth sentence of `qMn`, in the 2.1.280 to
// 2.1.283 bundles. No transcript on this machine holds one yet.
const SHELL_DELIVERED = /^\s*Command was moved to the background \(ID:\s*([A-Za-z0-9_-]+)\) so that a message/
// `Monitor started (task biifjm40h, timeout 3000000ms). You will be notified…`
const MONITOR_STARTED = /Monitor started \(task\s+([A-Za-z0-9_-]+)/
const AGENT_LAUNCHED = /(?:^|[\s(])agentId:\s*([A-Za-z0-9_-]+)/
// Tolerant of both observed layouts — one tag per line, and the whole record on
// a single line — plus the attributed opening tag and a record the transcript
// truncated before its closing tag.
const NOTIFICATION_OPENING = /<task-notification\b[^>]*>/g
const NOTIFICATION_CLOSING = '</task-notification>'
const NOTIFICATION_ID = /<task-id>\s*([^<]+?)\s*<\/task-id>/
const NOTIFICATION_STATUS = /<status>\s*([^<]+?)\s*<\/status>/
const NOTIFICATION_SUMMARY = /<summary>\s*([\S\s]*?)\s*<\/summary>/
const INTERRUPTED = /^\s*\[request interrupted/i

export type PendingCall = { name: string; input: unknown; startedAt: number | null }
export type Launch = {
  id: string
  kind: BackgroundTaskKind
  title: string
  startedAt: number | null
  /** What Claude's completion summary will quote for this launch: the Bash
   *  `description`, else the whole command (19 of 19 in one session's
   *  transcript; ~2,600 summaries on this machine, 2026-09-20). Whitespace
   *  folded, because the screen re-wraps it. Null for a kind whose summary
   *  says something else (agents, monitors). */
  label: string | null
  /** A workflow's meta and phases, from its call and launch result. */
  workflow?: WorkflowDetail
  /** Judged by the last Stop's `run=` alone: a status line's `live=` is built
   *  from Bash launch sentences and never names a workflow or a monitor. */
  stopListOnly?: true
}
/** `at` orders the finished list (the notification's place in the window);
 *  `timestamp` is when Claude wrote it, null when the ending came from
 *  somewhere with no time (a beacon id, a screen row). */
export type Notification = {
  status: string
  summary: string | null
  at: number
  timestamp: number | null
  /** The `<usage>` totals a finished workflow's notification states. */
  usage?: WorkflowUsage
}


/** Long enough to read a real description, short enough for one phone row. */
const TITLE_MAX = 60

/** What this call+result pair launched, or null when it launched nothing that
 *  keeps running after the tool returned. */
export function readLaunch(call: PendingCall, output: string): Launch | null {
  if (call.name === 'Bash') {
    const id =
      SHELL_STARTED.exec(output)?.[1] ??
      SHELL_MOVED.exec(output)?.[1] ??
      SHELL_BACKGROUNDED.exec(output)?.[1] ??
      SHELL_DELIVERED.exec(output)?.[1]
    return id
      ? { id, kind: 'shell', title: shellTitle(call.input), startedAt: call.startedAt, label: shellLabel(call.input) }
      : null
  }
  if (call.name === 'Agent') {
    const id = AGENT_LAUNCHED.exec(output)?.[1]
    return id ? { id, kind: 'agent', title: agentTitle(call.input), startedAt: call.startedAt, label: null } : null
  }
  if (call.name === 'Workflow') {
    const launched = readWorkflowLaunch(call.input, output)
    return launched
      ? { id: launched.id, kind: 'workflow', title: launched.title, startedAt: call.startedAt, label: null, workflow: launched.detail, stopListOnly: true }
      : null
  }
  if (call.name === 'Monitor') {
    // A monitor runs a command like a shell, but Claude Code counts it apart:
    // the Stop hook's `background_tasks` types it "monitor", and the footer
    // pill does not count it among its "N shells". Its event notifications
    // carry no status and never retire it — only the "stream ended" one does.
    const id = MONITOR_STARTED.exec(output)?.[1]
    return id ? { id, kind: 'monitor', title: shellTitle(call.input), startedAt: call.startedAt, label: null, stopListOnly: true } : null
  }
  return null
}

function shellTitle(input: unknown): string {
  const description = readString(input, 'description')
  if (description) {
    return truncate(description)
  }
  const command = readString(input, 'command')
  const firstLine = command?.split('\n', 1)[0]?.trim()
  return firstLine ? truncate(firstLine) : 'Background command'
}

function shellLabel(input: unknown): string | null {
  const quoted = readString(input, 'description') ?? readString(input, 'command')
  return quoted ? foldWhitespace(quoted) : null
}

/** One space for any run of whitespace, so a label read off a re-wrapped
 *  screen row compares equal to the one the transcript holds. */
export function foldWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim()
}

export function agentTitle(input: unknown): string {
  const named =
    readString(input, 'description') ?? readString(input, 'name') ?? readString(input, 'subagent_type')
  return named ? truncate(named) : 'Agent'
}

/** Cut at TITLE_MAX code units, never through an emoji: a cut between its two
 *  halves drew a broken glyph before the ellipsis. */
export function truncate(value: string): string {
  return value.length <= TITLE_MAX ? value : `${cutWholeCharacters(value, TITLE_MAX - 1).trimEnd()}…`
}

export function readString(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const value = Reflect.get(input, key)
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readNotifications(
  text: string,
  position: number,
  timestamp: number | null = null
): { id: string; value: Notification }[] {
  if (!text.includes('<task-notification')) {
    return []
  }
  const found: { id: string; value: Notification }[] = []
  for (const body of notificationBodies(text)) {
    const id = NOTIFICATION_ID.exec(body)?.[1]
    const status = NOTIFICATION_STATUS.exec(body)?.[1]
    if (!id || !status) {
      continue
    }
    const usage = readWorkflowUsage(body)
    found.push({
      id,
      value: { status, summary: NOTIFICATION_SUMMARY.exec(body)?.[1] ?? null, at: position, timestamp, ...(usage ? { usage } : {}) }
    })
  }
  return found
}

/** Each notification's body: from its opening tag to the LAST closing tag
 *  before the next genuine opening tag (or the end of the text), or to that
 *  point when it has none (a record the transcript cut). Not the first closing
 *  tag: the model-written `<result>` can quote one, and a cut there left a
 *  finished workflow's `<usage>` outside the body, so its card lost its totals
 *  (review, 2026-09-30). Nor every opening tag: one inside the record's own
 *  model-written text is a quote, and cutting there lost the same totals and
 *  began a phantom record (second review, 2026-09-30). */
function notificationBodies(text: string): string[] {
  const openings = [...text.matchAll(NOTIFICATION_OPENING)]
  const bodies: string[] = []
  let index = 0
  while (index < openings.length) {
    const opening = openings[index]
    const start = opening.index + opening[0].length
    let next = index + 1
    while (next < openings.length && endsInsideResult(text.slice(start, openings[next].index))) {
      next += 1
    }
    const segment = text.slice(start, openings[next]?.index ?? text.length)
    const end = segment.lastIndexOf(NOTIFICATION_CLOSING)
    bodies.push(end === -1 ? segment : segment.slice(0, end))
    index = next
  }
  return bodies
}

/** Whether a record, read up to a later opening tag, leaves that tag inside a
 *  `<result>` still open: the model wrote that text, so the tag is a quote.
 *  The `<summary>` needs no such care, because Claude escapes it
 *  (`&amp;&amp;`, see mobile-background-task-agent-titles.ts). The last
 *  `<result>` against the last `</result>`, not a count of the two: a result
 *  that quotes a lone `<result>` would keep a count open past its own record
 *  and swallow the next one. The price is a result that quotes a `</result>`
 *  before the tag, which still ends there and loses its totals, as it did
 *  before. */
function endsInsideResult(recordSoFar: string): boolean {
  return recordSoFar.lastIndexOf('<result>') > recordSoFar.lastIndexOf('</result>')
}

/** The sentence a background launch, a teammate's spawn or a remote launch
 *  opens its Agent result with. */
export const AGENT_LAUNCH_OPENING =
  /^\s*(?:Async agent launched successfully|Spawned successfully|Cloud agent launched)\./
/** An Agent call's own result: a launch (its sentence opens the result), or
 *  a finished run's report (its id line, then its usage block). Anchored, so
 *  a Read or a grep that merely prints `agentId: …` is not one. */
const AGENT_RESULT = new RegExp(
  `${AGENT_LAUNCH_OPENING.source}|<usage>\\s*subagent_tokens:|(?:^|\\n)agentId: [A-Za-z0-9_-]+ \\(use SendMessage`
)
/** A failure any tool can answer with: a tool error, or the user turning the
 *  call down. It says nothing about which call it answers. */
export const ANY_TOOL_FAILURE = /^\s*<tool_use_error>|^\s*The user doesn't want to proceed with this tool use/

/** The call a result answers. First in, first out — transcript blocks carry
 *  no tool ids — except that an Agent call is taken only by a result shaped
 *  like an Agent result, and such a result goes to the first Agent call. A
 *  turn's quick call (a Read beside a foreground Agent) can answer first, and
 *  handing its result to the Agent call would leave the agent still running
 *  with no call, and read any id the Read printed as a launch. A failure is
 *  plain first in, first out. */
export function takeAnsweredCall<Call extends PendingCall>(pending: Call[], output: string): Call | undefined {
  if (ANY_TOOL_FAILURE.test(output)) {
    return pending.shift()
  }
  const agentShaped = AGENT_RESULT.test(output)
  const index = pending.findIndex((call) => (call.name === 'Agent') === agentShaped)
  return index !== -1 ? pending.splice(index, 1)[0] : pending.shift()
}

export { INTERRUPTED }
