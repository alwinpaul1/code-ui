// ─── Background tasks, read out of the chat transcript the phone already has ─
// Claude Code records every background shell and every subagent in the same
// transcript the native chat view renders, so the phone can list them without
// asking the desktop for anything and without touching the user's machine.
//
// Three shapes carry it (verified against this machine's transcripts on
// 2026-09-09, Claude Code 2.x):
//   1. `Bash` with `run_in_background: true` → a tool-result saying
//      "Command running in background with ID: <id>".
//   2. `Agent` → a tool-result carrying "agentId: <id>".
//   3. A foreground `Bash` that blew its timeout → a tool-result saying it
//      "was moved to the background (ID: <id>)".
// Completion arrives later as a user-role `<task-notification>` turn naming the
// same id, which `stripNoiseMessages` hides from the conversation — so this
// reads the UNFILTERED message list, not the folded one the list renders.
//
// Codex records none of these, so a Codex tab derives an empty result and the
// running-tasks row never appears for it. Nothing here is gated on the agent
// name. The records in the transcript are what decide.

import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'

/**
 * What Orca's hooks know about the pane, to reconcile against the transcript.
 *
 * Why the transcript is not enough: a completion that lands MID-TURN is never
 * written as a user turn — Claude Code 2.1.266 stores it as an `attachment`
 * record (type `queued_command`) that Orca's transcript reader does not
 * surface. Observed 2026-09-09: five tasks shown running while two were. The
 * hooks fill the gap. SubagentStop keeps `subagents` current (absent = none
 * tracked, which is how Orca's own sidebar reads it), and Orca holds the pane
 * `working` while Claude's Stop hook still lists a running non-agent task, so
 * `done` means every background shell has reported. `null` = no host status
 * for this pane (an older host, or hooks not attached): trust the transcript.
 */
export type BackgroundTaskHostStatus = Pick<AgentStatusEntry, 'state' | 'subagents'>

export type BackgroundTaskKind = 'shell' | 'agent'
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed'

export type BackgroundTask = {
  /** Claude's own task id — a shell's `bzp6f42la`, or a subagent's `agentId`. */
  id: string
  kind: BackgroundTaskKind
  title: string
  status: BackgroundTaskStatus
  /** Epoch ms of the assistant turn that launched it; null when unrecorded. */
  startedAt: number | null
  /** `now − startedAt` for a running task; null for a finished one, and null
   *  when the transcript gave no timestamp to count from. */
  elapsedMs: number | null
  /** The notification's own one-line summary, kept for a caption. */
  summary?: string
}

export type BackgroundTasks = {
  running: BackgroundTask[]
  finished: BackgroundTask[]
}

// Exact sentences from the tool results. The id stops at the first `.` or `)`
// because none of the id alphabets include one.
const SHELL_STARTED = /Command running in background with ID:\s*([A-Za-z0-9_-]+)/
const SHELL_MOVED = /moved to the background \(ID:\s*([A-Za-z0-9_-]+)\)/
const AGENT_LAUNCHED = /(?:^|[\s(])agentId:\s*([A-Za-z0-9_-]+)/
// Tolerant of both observed layouts — one tag per line, and the whole record on
// a single line — plus the attributed opening tag and a record the transcript
// truncated before its closing tag.
const NOTIFICATION = /<task-notification\b[^>]*>([\S\s]*?)(?:<\/task-notification>|$)/g
const NOTIFICATION_ID = /<task-id>\s*([^<]+?)\s*<\/task-id>/
const NOTIFICATION_STATUS = /<status>\s*([^<]+?)\s*<\/status>/
const NOTIFICATION_SUMMARY = /<summary>\s*([\S\s]*?)\s*<\/summary>/
const INTERRUPTED = /^\s*\[request interrupted/i

/** Long enough to read a real description, short enough for one phone row. */
const TITLE_MAX = 60
/** Beyond this a summary is a paragraph, not a caption; drop it rather than
 *  truncate a sentence into something that reads as a different claim. */
const SUMMARY_MAX = 160

type PendingCall = { name: string; input: unknown; startedAt: number | null }
type Launch = { id: string; kind: BackgroundTaskKind; title: string; startedAt: number | null }
type Notification = { status: string; summary: string | null; at: number }

/** Split the transcript's background work into what is still running and what
 *  has reported back. Pure: `now` is the only clock, so tests set it. */
export function deriveBackgroundTasks(
  messages: readonly NativeChatMessage[],
  now: number,
  hostStatus: BackgroundTaskHostStatus | null = null
): BackgroundTasks {
  const pending: PendingCall[] = []
  const launches = new Map<string, Launch>()
  const notifications = new Map<string, Notification>()
  let position = 0
  for (const message of messages) {
    position += 1
    let text = ''
    for (const block of message.blocks) {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name, input: block.input, startedAt: message.timestamp })
      } else if (isToolResultBlock(block)) {
        // FIFO by ordinal: transcript blocks carry no tool ids (the same rule
        // `pairToolBlocks` uses in src/shared/native-chat-tool-fold.ts).
        const call = pending.shift()
        const launch = call ? readLaunch(call, block.output) : null
        if (launch && !launches.has(launch.id)) {
          launches.set(launch.id, launch)
        }
      } else if (isTextBlock(block)) {
        text += block.text
      }
    }
    // An interrupted turn never delivers results for the calls it left in
    // flight; keeping them would pair the next turn's result with the wrong
    // command and mistitle the task.
    if (INTERRUPTED.test(text)) {
      pending.length = 0
    }
    for (const notification of readNotifications(text, position)) {
      notifications.set(notification.id, notification.value)
    }
  }
  return splitByStatus(launches, notifications, now, hostStatus, position + 1)
}

function splitByStatus(
  launches: ReadonlyMap<string, Launch>,
  notifications: ReadonlyMap<string, Notification>,
  now: number,
  hostStatus: BackgroundTaskHostStatus | null,
  afterTranscript: number
): BackgroundTasks {
  const running: BackgroundTask[] = []
  const finished: { task: BackgroundTask; at: number }[] = []
  const roster = liveSubagentRoster(hostStatus)
  const paneDone = hostStatus?.state === 'done'
  for (const launch of launches.values()) {
    const notification = notifications.get(launch.id)
    if (!notification) {
      // Why: an idle teammate is alive but not working, so it is not "running".
      const hostSaysFinished =
        paneDone || (launch.kind === 'agent' && roster !== null && !roster.has(launch.id))
      if (hostSaysFinished) {
        finished.push({
          at: afterTranscript,
          task: { ...launch, status: 'completed', elapsedMs: null }
        })
        continue
      }
      running.push({ ...launch, status: 'running', elapsedMs: elapsedSince(launch.startedAt, now) })
      continue
    }
    const summary = captionOf(notification.summary)
    finished.push({
      at: notification.at,
      task: {
        ...launch,
        status: isFailureStatus(notification.status) ? 'failed' : 'completed',
        elapsedMs: null,
        ...(summary ? { summary } : {})
      }
    })
  }
  // A subagent the host is tracking but the loaded transcript window never
  // showed (launched before the page, or its launch record paginated out).
  if (roster && !paneDone) {
    for (const [id, snapshot] of roster) {
      if (launches.has(id)) {
        continue
      }
      running.push({
        id,
        kind: 'agent',
        title: truncate(snapshot.description?.trim() || snapshot.agentType?.trim() || id),
        status: 'running',
        startedAt: snapshot.startedAt,
        elapsedMs: elapsedSince(snapshot.startedAt, now)
      })
    }
  }
  // Running stays in launch order (the oldest job is the one people look for);
  // finished is newest-first, by when its notification landed.
  finished.sort((left, right) => right.at - left.at)
  return { running, finished: finished.map((entry) => entry.task) }
}

/** Subagents the host still counts as busy, by id; null when the host gave no
 *  status at all (then only the transcript can speak). */
function liveSubagentRoster(
  hostStatus: BackgroundTaskHostStatus | null
): Map<string, NonNullable<AgentStatusEntry['subagents']>[number]> | null {
  if (!hostStatus) {
    return null
  }
  const roster = new Map<string, NonNullable<AgentStatusEntry['subagents']>[number]>()
  for (const snapshot of hostStatus.subagents ?? []) {
    if (snapshot.state !== 'idle') {
      roster.set(snapshot.id, snapshot)
    }
  }
  return roster
}

/** A notification means the task stopped. Only an explicitly bad status is
 *  shown as a failure — an unrecognised one is reported as merely finished
 *  rather than guessed into an alarm. */
function isFailureStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === 'failed' || normalized === 'error' || normalized === 'failure'
}

function elapsedSince(startedAt: number | null, now: number): number | null {
  return startedAt === null ? null : Math.max(0, now - startedAt)
}

function captionOf(summary: string | null): string | undefined {
  if (!summary) {
    return undefined
  }
  const single = summary.replaceAll(/\s+/g, ' ').trim()
  return single.length > 0 && single.length <= SUMMARY_MAX ? single : undefined
}

/** What this call+result pair launched, or null when it launched nothing that
 *  keeps running after the tool returned. */
function readLaunch(call: PendingCall, output: string): Launch | null {
  if (call.name === 'Bash') {
    const id = SHELL_STARTED.exec(output)?.[1] ?? SHELL_MOVED.exec(output)?.[1]
    return id ? { id, kind: 'shell', title: shellTitle(call.input), startedAt: call.startedAt } : null
  }
  if (call.name === 'Agent') {
    const id = AGENT_LAUNCHED.exec(output)?.[1]
    return id ? { id, kind: 'agent', title: agentTitle(call.input), startedAt: call.startedAt } : null
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

function truncate(value: string): string {
  return value.length <= TITLE_MAX ? value : `${value.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

function readString(input: unknown, key: string): string | null {
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

function readNotifications(
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

/** How many background tasks are still in flight. Which tasks are running does
 *  not depend on the clock, so the chat view can read the count for its row
 *  without holding one — only `elapsedMs` needs `now`, and only the sheet
 *  shows that. */
export function countRunningBackgroundTasks(
  messages: readonly NativeChatMessage[],
  hostStatus: BackgroundTaskHostStatus | null = null
): number {
  return deriveBackgroundTasks(messages, 0, hostStatus).running.length
}

/** "19m 8s" while a job runs; "2h 19m" once it is past the hour. Null when the
 *  transcript never said when the task started — no invented stopwatch. */
export function formatBackgroundTaskElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs === null) {
    return null
  }
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatRunningTaskCount(count: number): string {
  return `${count} running task${count === 1 ? '' : 's'}`
}

export function backgroundTaskKindLabel(kind: BackgroundTaskKind): string {
  return kind === 'agent' ? 'Agent' : 'Shell'
}

export function backgroundTaskStatusLabel(status: BackgroundTaskStatus): string {
  return status === 'failed' ? 'Failed' : status === 'completed' ? 'Completed' : 'Running'
}
