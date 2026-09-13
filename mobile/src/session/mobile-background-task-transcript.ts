import type { BackgroundTaskKind } from './mobile-background-tasks'

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
const SHELL_STARTED = /^\s*Command running in background with ID:\s*([A-Za-z0-9_-]+)/
const SHELL_MOVED = /^\s*Command did not complete[^\n]{0,120}?moved to the background \(ID:\s*([A-Za-z0-9_-]+)\)/
// ctrl+b on a running command (Claude Code 2.1.270, 2026-09-13): a third
// shape, which left the desk at 4 shells and the phone at 2.
const SHELL_BACKGROUNDED = /^\s*Command was manually backgrounded by user with ID:\s*([A-Za-z0-9_-]+)/
// `Monitor started (task biifjm40h, timeout 3000000ms). You will be notified…`
const MONITOR_STARTED = /Monitor started \(task\s+([A-Za-z0-9_-]+)/
const AGENT_LAUNCHED = /(?:^|[\s(])agentId:\s*([A-Za-z0-9_-]+)/
// Tolerant of both observed layouts — one tag per line, and the whole record on
// a single line — plus the attributed opening tag and a record the transcript
// truncated before its closing tag.
const NOTIFICATION = /<task-notification\b[^>]*>([\S\s]*?)(?:<\/task-notification>|$)/g
const NOTIFICATION_ID = /<task-id>\s*([^<]+?)\s*<\/task-id>/
const NOTIFICATION_STATUS = /<status>\s*([^<]+?)\s*<\/status>/
const NOTIFICATION_SUMMARY = /<summary>\s*([\S\s]*?)\s*<\/summary>/
const INTERRUPTED = /^\s*\[request interrupted/i

export type PendingCall = { name: string; input: unknown; startedAt: number | null }
export type Launch = { id: string; kind: BackgroundTaskKind; title: string; startedAt: number | null }
export type Notification = { status: string; summary: string | null; at: number }


/** Long enough to read a real description, short enough for one phone row. */
const TITLE_MAX = 60

/** What this call+result pair launched, or null when it launched nothing that
 *  keeps running after the tool returned. */
export function readLaunch(call: PendingCall, output: string): Launch | null {
  if (call.name === 'Bash') {
    const id =
      SHELL_STARTED.exec(output)?.[1] ??
      SHELL_MOVED.exec(output)?.[1] ??
      SHELL_BACKGROUNDED.exec(output)?.[1]
    return id ? { id, kind: 'shell', title: shellTitle(call.input), startedAt: call.startedAt } : null
  }
  if (call.name === 'Agent') {
    const id = AGENT_LAUNCHED.exec(output)?.[1]
    return id ? { id, kind: 'agent', title: agentTitle(call.input), startedAt: call.startedAt } : null
  }
  if (call.name === 'Monitor') {
    // A monitor is a long-running shell; its event notifications carry no
    // status and never retire it — only the "stream ended" one does.
    const id = MONITOR_STARTED.exec(output)?.[1]
    return id ? { id, kind: 'shell', title: shellTitle(call.input), startedAt: call.startedAt } : null
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

function agentTitle(input: unknown): string {
  const named =
    readString(input, 'description') ?? readString(input, 'name') ?? readString(input, 'subagent_type')
  return named ? truncate(named) : 'Agent'
}

export function truncate(value: string): string {
  return value.length <= TITLE_MAX ? value : `${value.slice(0, TITLE_MAX - 1).trimEnd()}…`
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
  position: number
): { id: string; value: Notification }[] {
  if (!text.includes('<task-notification')) {
    return []
  }
  const found: { id: string; value: Notification }[] = []
  for (const match of text.matchAll(NOTIFICATION)) {
    const body = match[1] ?? ''
    const id = NOTIFICATION_ID.exec(body)?.[1]
    const status = NOTIFICATION_STATUS.exec(body)?.[1]
    if (!id || !status) {
      continue
    }
    found.push({
      id,
      value: { status, summary: NOTIFICATION_SUMMARY.exec(body)?.[1] ?? null, at: position }
    })
  }
  return found
}

export { INTERRUPTED }
