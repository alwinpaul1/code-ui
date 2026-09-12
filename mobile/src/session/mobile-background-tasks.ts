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
import {
  INTERRUPTED,
  readLaunch,
  readNotifications,
  readString,
  truncate,
  type Launch,
  type Notification,
  type PendingCall
} from './mobile-background-task-transcript'

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
export type BackgroundTaskHostStatus = Pick<AgentStatusEntry, 'state' | 'subagents'> &
  Partial<Pick<AgentStatusEntry, 'stateStartedAt' | 'workingMode'>>

export type BackgroundTaskDeriveOptions = {
  /** Task ids the agent's own beacon reports finished (`agent-hud-beacon.ts`).
   *  Why: a completion that lands mid-turn is written to Claude's transcript as
   *  a queue-operation record Orca never surfaces, but the status-line script
   *  reads that transcript on every refresh and beacons the ids within seconds. */
  finishedTaskIds?: readonly string[]
  /** What the agent itself says is still running, from its Stop hook beacon.
   *  When present this OUTRANKS the transcript for retiring: a launch missing
   *  from it has ended, whatever the transcript does or does not record. It
   *  does not ADD on its own — an id here that no launch record (the loaded
   *  window or `launchedTaskIds`) ever showed is not listed, because the Stop
   *  payload also calls an idle teammate `running`. Null or absent means the
   *  agent has not answered yet — mid-turn, the Stop hook has not fired — and
   *  the transcript remains the only source. */
  runningTaskIds?: readonly string[] | null
  /** When `runningTaskIds` arrived (phone clock, epoch ms). The Stop hook
   *  speaks only when a turn ends, so that list cannot name a shell launched
   *  after it: a launch newer than this time is not judged by it. Null or
   *  absent means the time is unknown and the list judges every launch. */
  runningTaskIdsAt?: number | null
  /** Shells the beacon saw launched in the transcript tail (`bg=`). One the
   *  loaded window never showed, with no notification and not in `done=`, is
   *  running — this is the transcript itself, read further back than the
   *  window, and fresher than the Stop hook's `run=` mid-turn. */
  launchedTaskIds?: readonly string[]
}

/** `shell`, `agent` and `monitor` are what the transcript reader can name.
 *  `workflow` and `unknown` only ever arrive from the host's own roster
 *  (`mobile-structured-background-tasks.ts`), which speaks the wire's five
 *  kinds — calling those two "shell" would put a claim on the row that the
 *  host never made. */
export type BackgroundTaskKind = 'shell' | 'agent' | 'monitor' | 'workflow' | 'unknown'
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

/** How long the desk's bare `monitoring` state may stand in for a shell the
 *  agent has not named; its beacons arrive within seconds of a live pane. */
const MONITORING_PLACEHOLDER_MAX_AGE_MS = 30 * 60_000

/** Beyond this a summary is a paragraph, not a caption; drop it rather than
 *  truncate a sentence into something that reads as a different claim. */
const SUMMARY_MAX = 160

/** Split the transcript's background work into what is still running and what
 *  has reported back. Pure: `now` is the only clock, so tests set it. */
export function deriveBackgroundTasks(
  messages: readonly NativeChatMessage[],
  now: number,
  hostStatus: BackgroundTaskHostStatus | null = null,
  options: BackgroundTaskDeriveOptions = {}
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
        // Why: stopping a task is the one completion the transcript records
        // even mid-turn — the model asked for it, so the call itself is there.
        const stoppedId = block.name === 'TaskStop' ? readString(block.input, 'task_id') : null
        if (stoppedId) {
          notifications.set(stoppedId, { status: 'stopped', summary: null, at: position })
        }
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
  for (const id of options.finishedTaskIds ?? []) {
    if (!notifications.has(id)) {
      notifications.set(id, { status: 'completed', summary: null, at: position + 1 })
    }
  }
  return splitByStatus(
    launches,
    notifications,
    now,
    hostStatus,
    position + 1,
    options.runningTaskIds ?? null,
    options.launchedTaskIds ?? [],
    options.runningTaskIdsAt ?? null
  )
}

function splitByStatus(
  launches: ReadonlyMap<string, Launch>,
  notifications: ReadonlyMap<string, Notification>,
  now: number,
  hostStatus: BackgroundTaskHostStatus | null,
  afterTranscript: number,
  reportedRunning: readonly string[] | null,
  reportedLaunched: readonly string[] = [],
  reportedRunningAt: number | null = null
): BackgroundTasks {
  const agentSaysRunning = reportedRunning === null ? null : new Set(reportedRunning)
  const running: BackgroundTask[] = []
  const finished: { task: BackgroundTask; at: number }[] = []
  const roster = liveSubagentRoster(hostStatus)
  const paneDone = hostStatus?.state === 'done'
  // Why: the pane only leaves `working` when Claude's Stop hook lists no live
  // background task, so the current working run's start is the last moment at
  // which everything launched earlier was known to have finished. Without it,
  // a `done` that retired old launches flipped them back to running on the
  // next prompt (eight hours-old shells shown running, 2026-09-09).
  const runStartedAt =
    hostStatus?.state === 'working' && typeof hostStatus.stateStartedAt === 'number'
      ? hostStatus.stateStartedAt
      : null
  for (const launch of launches.values()) {
    const notification = notifications.get(launch.id)
    if (!notification) {
      // Why: an idle teammate is alive but not working, so it is not "running".
      const launchedBeforeRun =
        runStartedAt !== null && launch.startedAt !== null && launch.startedAt < runStartedAt
      // Why the time check: on 2026-09-12 two shells launched mid-turn never
      // reached the row. The `run=` the phone held was the previous turn's
      // answer, which could not list shells that did not exist yet, and "not
      // on the list" was read as "finished". An answer given before a launch
      // says nothing about it.
      const answeredBeforeLaunch =
        reportedRunningAt !== null && launch.startedAt !== null && launch.startedAt > reportedRunningAt
      const hostSaysFinished =
        paneDone ||
        launchedBeforeRun ||
        // The agent's own answer, when it has given one that postdates the launch.
        (agentSaysRunning !== null && !answeredBeforeLaunch && !agentSaysRunning.has(launch.id)) ||
        (launch.kind === 'agent' && roster !== null && !roster.has(launch.id))
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
  // A task the agent reports but the loaded transcript never showed: launched
  // before the page the phone holds, or paginated out of it — provided the
  // status line's `bg=` DID see it launched, further up the same transcript.
  // Why the second condition: Claude Code's Stop payload calls a teammate
  // `running` for as long as it exists, idle included, and nothing ever
  // launches a teammate as a task. On 2026-09-12 four council reviewers a day
  // idle became "4 running tasks" on the phone while the desk showed none.
  // The hook now skips teammates, but a tab keeps the hook it was launched
  // with, so the reader holds the line too: an id nobody saw launched is not
  // shown. Prefer refusing over guessing — a bare id was never a useful row.
  const seenLaunched = new Set(reportedLaunched)
  if (agentSaysRunning) {
    for (const id of agentSaysRunning) {
      if (launches.has(id) || notifications.has(id) || !seenLaunched.has(id)) {
        continue
      }
      running.push({ id, kind: 'shell', title: id, status: 'running', startedAt: null, elapsedMs: null })
    }
  }
  // A shell the beacon saw launched in the transcript tail, above the loaded
  // window, with no notification in that tail: running until one lands.
  const listed = new Set(running.map((task) => task.id))
  for (const id of reportedLaunched) {
    if (launches.has(id) || notifications.has(id) || listed.has(id) || paneDone) {
      continue
    }
    running.push({ id, kind: 'shell', title: id, status: 'running', startedAt: null, elapsedMs: null })
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
  // The host has already said shells are running — Orca keeps a pane
  // `working` in `monitoring` mode exactly while Claude's Stop hook lists
  // background tasks — but the loaded window shows no launch and the agent has
  // not yet named them (its `run=` beacon comes with its next Stop hook; a big
  // transcript's launches sit far above the tail the phone holds). Show one
  // running shell rather than an empty row until either source arrives.
  // Age-capped: a `monitoring` state hours old with no beacon is a pane whose
  // Stop hook never finished (2026-09-11: a turn died on an expired OAuth
  // token and the phone read "1 running task" for a day), not a shell.
  const monitoringAgeMs = runStartedAt === null ? null : now - runStartedAt
  if (
    running.length === 0 &&
    agentSaysRunning === null &&
    hostStatus?.state === 'working' &&
    hostStatus.workingMode === 'monitoring' &&
    monitoringAgeMs !== null &&
    monitoringAgeMs < MONITORING_PLACEHOLDER_MAX_AGE_MS
  ) {
    running.push({
      id: 'host-monitoring',
      kind: 'shell',
      title: 'Background shell the desk is still tracking',
      status: 'running',
      startedAt: runStartedAt,
      elapsedMs: elapsedSince(runStartedAt, now)
    })
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

/** How many background tasks are still in flight. The chat view reads this
 *  for its row without a ticking clock: the only clock-dependent decision is
 *  whether the desk's bare `monitoring` state is fresh enough to stand in for
 *  a shell, and that needs one reading of `now`, not a re-render per second. */
export function countRunningBackgroundTasks(
  messages: readonly NativeChatMessage[],
  hostStatus: BackgroundTaskHostStatus | null = null,
  options: BackgroundTaskDeriveOptions = {},
  now: number = Date.now()
): number {
  return deriveBackgroundTasks(messages, now, hostStatus, options).running.length
}
