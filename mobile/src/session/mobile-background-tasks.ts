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
// What it counts is the SESSION's own work: the shells the lead started and
// the agents the lead started, as Claude Code's agent panel lists them. A
// reviewer one of those agents starts shares the lead's task registry, and so
// the host's roster and the footer's shell count, but it is not the lead's
// task (`mobile-background-task-roster.ts`).
//
// Codex records none of these shapes, so on a Codex tab the host's roster is
// the whole answer. Nothing here is gated on the agent name; the records, and
// the provenance the caller can or cannot supply, decide.

import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { SubagentRunClock } from './mobile-subagent-runs'
import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  INTERRUPTED,
  foldWhitespace,
  readLaunch,
  readNotifications,
  stoppedTaskId,
  takeAnsweredCall,
  truncate,
  type Launch,
  type Notification,
  type PendingCall
} from './mobile-background-task-transcript'
import { settleAgentLaunches } from './mobile-background-task-agent-titles'
import { applyAgentResumes, createResumeTracker, trackCall, trackMessage, trackResult } from './mobile-background-task-resumes'
import { captionOf, elapsedSince, isFailureStatus } from './mobile-background-task-captions'
import { foldWorkflowAgents, oldestTimestamp, verdictFor, type WorkflowDetail } from './mobile-background-task-workflows'
import { fitToOnScreenShellCount, type HeldShellCount } from './mobile-background-task-footer'
import {
  createRosterOwnership,
  isTeammateLifecycleId,
  liveSubagentRoster,
  type AgentProvenance,
  type RosterRow
} from './mobile-background-task-roster'

/**
 * What Orca's hooks know about the pane, to reconcile against the transcript.
 *
 * Why the transcript is not enough: a completion that lands MID-TURN is never
 * written as a user turn — Claude Code 2.1.266 stores it as an `attachment`
 * record (type `queued_command`) that Orca's transcript reader does not
 * surface. Observed 2026-09-09: five tasks shown running while two were. The
 * hooks fill the gap. SubagentStart/SubagentStop keep `subagents` current
 * (absent = none tracked, which is how Orca's own sidebar reads it), and it is
 * the authority on every agent it tracks. Orca holds the pane `working` while
 * Claude's Stop hook still lists a running non-agent task, so `done` means
 * every background shell has reported. `null` = no host status for this pane
 * (an older host, or hooks not attached): trust the transcript.
 */
export type BackgroundTaskHostStatus = Pick<AgentStatusEntry, 'state' | 'subagents'> &
  // `providerSession` is read only for its transcript path, which says where
  // a subagent's own transcript sits (`mobile-subagent-transcript.ts`).
  Partial<Pick<AgentStatusEntry, 'stateStartedAt' | 'workingMode' | 'providerSession'>>

export type BackgroundTaskDeriveOptions = {
  /** When each roster subagent's current run began, as the phone watched it
   *  (`mobile-subagent-runs.ts`). Absent, or absent for an id, means unknown:
   *  the row shows no time. Never the roster's first-observed age. */
  subagentRuns?: SubagentRunClock
  /** Task ids the agent's own beacon reports finished (`agent-hud-beacon.ts`),
   *  plus every id a loaded window has shown retired this session.
   *  Why: a completion that lands mid-turn is written to Claude's transcript as
   *  a queue-operation record Orca never surfaces, but the status-line script
   *  reads that transcript on every refresh and beacons the ids within seconds. */
  finishedTaskIds?: readonly string[]
  /** What the agent itself says is still running: the status line's `live=`
   *  (shells launched minus finished, in its transcript tail) or the Stop
   *  hook's `run=` (`background_tasks`, at a turn end). It judges SHELLS only:
   *  `live=` never names an agent, and `run=` lasts one beacon and names every
   *  subagent in the process, reviewers included. When present it OUTRANKS the
   *  transcript for retiring a shell. It does not ADD on its own — an id here
   *  that no launch record (the loaded window or `launchedTaskIds`) ever
   *  showed is not listed, because the Stop payload also calls an idle
   *  teammate `running`. Null or absent means the agent has not answered. */
  runningTaskIds?: readonly string[] | null
  /** When `runningTaskIds` arrived (phone clock, epoch ms). The Stop hook
   *  speaks only when a turn ends, so that list cannot name a shell launched
   *  after it: a launch newer than this time is not judged by it. Null or
   *  absent means the time is unknown and the list judges every launch. */
  runningTaskIdsAt?: number | null
  /** The last Stop hook's `run=` alone, and when it arrived: the only list that
   *  can name a workflow or a monitor, which `live=` never does. Judges those
   *  two; null or absent judges neither (`mobile-background-task-workflows.ts`). */
  stopRunningTaskIds?: readonly string[] | null
  stopRunningTaskIdsAt?: number | null
  /** Shells the beacon saw launched in the transcript tail (`bg=`). One the
   *  loaded window never showed, with no notification and not in `done=`, is
   *  running — this is the transcript itself, read further back than the
   *  window, and fresher than the Stop hook's `run=` mid-turn. */
  launchedTaskIds?: readonly string[]
  /** Completions the agent stated on its own screen: the notification's
   *  summary as Claude paints it when a task's notification lands, read and
   *  latched by the phone (`mobile-terminal-task-completions.ts`). Each names
   *  the task by the text Claude quotes — its `description`, else its
   *  command — and says how it ended. One entry retires one launch: the
   *  oldest still-running shell with that label among the launches it is
   *  bound to (`launchIds`). Why: on a hand-started tab
   *  there is no beacon, and a mid-turn completion is otherwise invisible
   *  until every shell has finished (2026-09-20). The launch is the phone's,
   *  the verdict the agent's; a row naming nothing the phone holds retires
   *  nothing. */
  screenCompletions?: readonly ScreenTaskCompletion[]
  /** How many background shells the agent's OWN footer says are running, read
   *  off the screen (`parseClaudeRunningShellCount`). It counts every shell
   *  in the process, a subagent's too, so it caps the lead's named shells
   *  and pads unnamed ones only up to what the lead can have
   *  (`mobile-background-task-footer.ts`). Null when no footer count is on
   *  screen. */
  onScreenShellCount?: number | null
  /** The last footer count, kept while the footer is off screen. */
  heldOnScreenShellCount?: HeldShellCount | null
  /** The last footer count read while no subagent ran: then every shell in
   *  it was the lead's, and those can only finish. */
  leadOnlyShellCount?: HeldShellCount | null
  /** The start of the working run that followed the pane's last `done`, as
   *  the phone watched it (`mobile-background-task-memory.ts`). A question
   *  or a permission prompt moves `stateStartedAt` without ending the work
   *  launched before it; this does not move then. Null: no such start is
   *  known, so nothing is retired by it. Absent: `stateStartedAt` stands in. */
  runBoundaryAt?: number | null
  /** Which roster agents the session itself started. Null or absent: the
   *  caller cannot tell (a Codex tab), and every working roster row counts. */
  agentProvenance?: AgentProvenance | null
}

/** A completion row as read off the agent's screen. `status` is the word the
 *  row uses (`completed`, `failed`, `stopped`), judged like a notification's.
 *  `launchIds` are the launches the row may retire, bound by the memory that
 *  keeps it (`mobile-screen-completion-memory.ts`): those with its label the
 *  transcript window held when the phone first saw it. Absent means unbound,
 *  and the row judges every launch with its label. */
export type ScreenTaskCompletion = { label: string; status: string; launchIds?: readonly string[] }

/** `shell`, `agent` and `monitor` are what the transcript reader can name.
 *  `workflow` and `unknown` only ever arrive from the host's own roster
 *  (`mobile-structured-background-tasks.ts`), which speaks the wire's five
 *  kinds — calling those two "shell" would put a claim on the row that the
 *  host never made. */
export type BackgroundTaskKind = 'shell' | 'agent' | 'monitor' | 'workflow' | 'unknown'
/** `finished` is a shell the agent's own footer count retired: over, outcome
 *  unseen. `completed` and `failed` come from a notification that said so. */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'finished'

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
  /** Whether the host can stop this row by name. Absent means yes — every
   *  roster before Orca #19705 listed only backgrounded, stoppable work. A
   *  foreground subagent inside a live turn arrives as `false`: the SDK has no
   *  way to reach it, so drawing a Stop there is a dead button. */
  stoppable?: boolean
  /** A Workflow's card: description, phases, its running agents, and the
   *  totals once it has finished (`mobile-background-task-workflows.ts`). */
  workflow?: WorkflowDetail
  /** Cumulative tokens the provider reported for this task, where the host states them (a
   *  structured roster's `totalTokens`). Absent is unknown, and nothing is shown for it. */
  totalTokens?: number
}

export type BackgroundTasks = {
  running: BackgroundTask[]
  finished: BackgroundTask[]
}

/** How long the desk's bare `monitoring` state may stand in for a shell the
 *  agent has not named; its beacons arrive within seconds of a live pane. */
const MONITORING_PLACEHOLDER_MAX_AGE_MS = 30 * 60_000


/** Split the transcript's background work into what is still running and what
 *  has reported back. Pure: `now` is the only clock, so tests set it. The one
 *  side effect is a console line, once per result, for a resume it refuses. */
export function deriveBackgroundTasks(
  messages: readonly NativeChatMessage[],
  now: number,
  hostStatus: BackgroundTaskHostStatus | null = null,
  options: BackgroundTaskDeriveOptions = {}
): BackgroundTasks {
  const pending: (PendingCall & { at: number })[] = []
  const launches = new Map<string, Launch>()
  const notifications = new Map<string, Notification>()
  const sends = createResumeTracker()
  let position = 0
  for (const message of messages) {
    position += 1
    let text = ''
    trackMessage(sends, message)
    for (const block of message.blocks) {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name, input: block.input, startedAt: message.timestamp, at: position, callId: block.callId })
        trackCall(sends, block.name, block.input)
      } else if (isToolResultBlock(block)) {
        // A result that names its call (`callId`, a structured chat's) is that
        // call's, as `pairToolBlocks` (src/shared/native-chat-tool-fold.ts)
        // pairs it: a fast-failing call's result no longer takes an earlier
        // call still running, which then took the next launch's result and
        // lost that background task. One that names none (a transcript's) is
        // paired by position, oldest unanswered call first, save that an
        // Agent call waits for an Agent-shaped result (`takeAnsweredCall`).
        const call = takeAnsweredCall(pending, block)
        const launch = call ? readLaunch(call, block.output) : null
        if (launch && !launches.has(launch.id)) {
          launches.set(launch.id, launch)
        }
        // Why: stopping a task is the one completion the transcript records
        // even mid-turn, and no notification follows it. The call alone is
        // only the lead asking: a stop the user turned down, or that errored,
        // left the task running (review, 2026-09-30), so the stop counts once
        // its answer says it went through, placed and timed at its call. A
        // notification the task sent while the stop waited is the later word,
        // and keeps its status and summary.
        const stoppedId = call ? stoppedTaskId(call, block) : null
        const known = stoppedId ? notifications.get(stoppedId) : undefined
        if (call && stoppedId && (known?.at ?? 0) <= call.at) {
          notifications.set(stoppedId, { status: 'stopped', summary: null, at: call.at, timestamp: call.startedAt })
        }
        // A SendMessage that resumed a stopped agent starts a new run of it.
        // Read off whichever result names the agent a waiting SendMessage of
        // this step addressed, not off the call the pairing above hands it:
        // parallel results come back in any order
        // (`mobile-background-task-resumes.ts`).
        trackResult(sends, block.output, message.id, { at: position, timestamp: message.timestamp })
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
    for (const notification of readNotifications(text, position, message.timestamp)) {
      notifications.set(notification.id, notification.value)
    }
  }
  // Results land in the order launches were acknowledged, not the order of
  // the calls, so parallel agents are re-paired by what Claude Code says.
  const confirmed = settleAgentLaunches(launches, notifications, messages, hostStatus?.subagents, position + 1)
  applyAgentResumes({
    launches,
    notifications,
    resumes: sends.resumes,
    lastPosition: position,
    describe: (id) => confirmed.get(id) ?? hostStatus?.subagents?.find((row) => row.id === id)?.agentType?.trim()
  })
  // Only an id, no time: against a roster row it cannot end a resumed run
  // (`endedThisRun` needs a time); with no host status it does, because then
  // nothing else can (`mobile-background-task-resumes.ts`).
  for (const id of options.finishedTaskIds ?? []) {
    if (!notifications.has(id)) {
      notifications.set(id, { status: 'completed', summary: null, at: position + 1, timestamp: null })
    }
  }
  // Launch order is insertion order, so the first unsettled match is the
  // oldest; two shells sharing a description are retired one per row, oldest
  // first — the order Claude would have to deliver them in anyway.
  // A row retires only a launch it is bound to. The phone keeps a row for the
  // whole session, so once the first run's own notification settled it, the
  // row went on to retire a relaunch under the same description the moment
  // it started (2026-09-30). Bound by id, not by comparing the launch's time
  // (the desk's clock) with when the phone saw the row (its own).
  for (const completion of options.screenCompletions ?? []) {
    const label = foldWhitespace(completion.label)
    const bound = completion.launchIds ?? null
    for (const launch of launches.values()) {
      const boundElsewhere = bound !== null && !bound.includes(launch.id)
      if (launch.kind === 'shell' && launch.label === label && !notifications.has(launch.id) && !boundElsewhere) {
        notifications.set(launch.id, { status: completion.status, summary: null, at: position + 1, timestamp: null })
        break
      }
    }
  }
  const live = options.onScreenShellCount ?? null
  const held = options.heldOnScreenShellCount ?? null
  const roster = liveSubagentRoster(hostStatus)
  // While any subagent runs, the footer holds shells the phone cannot name.
  const agentLaunchUnsettled = [...launches.values()].some((launch) => launch.kind === 'agent' && !notifications.has(launch.id))
  const subagentRunning = roster === null ? agentLaunchUnsettled : roster.size > 0
  const working = hostStatus?.state === 'working'
  const stateStart = working && typeof hostStatus.stateStartedAt === 'number' ? hostStatus.stateStartedAt : null
  const tasks = splitByStatus({
    launches,
    notifications,
    now,
    hostStatus,
    roster,
    afterTranscript: position + 1,
    reportedRunning: options.runningTaskIds ?? null,
    reportedLaunched: options.launchedTaskIds ?? [],
    reportedRunningAt: options.runningTaskIdsAt ?? null,
    stopRunning: options.stopRunningTaskIds ?? null,
    stopRunningAt: options.stopRunningTaskIdsAt ?? null,
    subagentRuns: options.subagentRuns ?? null,
    stateStart,
    runBoundary: options.runBoundaryAt === undefined ? stateStart : working ? options.runBoundaryAt : null,
    ownedByLead: createRosterOwnership(options.agentProvenance ?? null)
  })
  const fitted = fitToOnScreenShellCount(tasks, now, { live, held, subagentRunning, leadOnly: options.leadOnlyShellCount ?? null })
  return foldWorkflowAgents(fitted, hostStatus?.subagents, {
    hostDone: hostStatus?.state === 'done',
    beaconRunning: options.stopRunningTaskIds ?? null,
    beaconAt: options.stopRunningTaskIdsAt ?? null,
    windowOldestAt: oldestTimestamp(messages),
    launchedIds: new Set(launches.keys())
  })
}

type SplitContext = {
  launches: ReadonlyMap<string, Launch>
  notifications: ReadonlyMap<string, Notification>
  now: number
  hostStatus: BackgroundTaskHostStatus | null
  roster: ReadonlyMap<string, RosterRow> | null
  afterTranscript: number
  reportedRunning: readonly string[] | null
  reportedLaunched: readonly string[]
  reportedRunningAt: number | null
  /** The last Stop's `run=` and its time: what judges a workflow or a monitor. */
  stopRunning: readonly string[] | null
  stopRunningAt: number | null
  subagentRuns: SubagentRunClock | null
  /** When the pane's current `working` state began; null when it is not
   *  working. What the desk's `monitoring` placeholder is aged by. */
  stateStart: number | null
  /** Launches before this are known to have finished, when nothing else can
   *  speak for them; null retires nothing. */
  runBoundary: number | null
  ownedByLead: (id: string) => boolean
}

function splitByStatus(context: SplitContext): BackgroundTasks {
  const { launches, notifications, now, hostStatus, roster, afterTranscript } = context
  const agentSaysRunning = context.reportedRunning === null ? null : new Set(context.reportedRunning)
  const running: BackgroundTask[] = []
  const finished: { task: BackgroundTask; at: number }[] = []
  const paneDone = hostStatus?.state === 'done'
  // Why: the pane leaves `working` for `done` only when Claude's Stop hook
  // lists no live background task, so the start of the run after a `done` is
  // the last moment at which everything launched earlier was known to have
  // finished. A `waiting` (a question, a permission prompt) moves the pane's
  // start too while work runs on (session 967668df, 23:24:06), which is why
  // the boundary is the phone's own record of the run after the last `done`
  // when it has one. It speaks for a shell only when no beacon list does.
  // Without it, a `done` that retired old launches flipped them back to
  // running on the next prompt (eight hours-old shells shown running,
  // 2026-09-09).
  const runBoundary = agentSaysRunning === null ? context.runBoundary : null
  for (const launch of launches.values()) {
    const notification = notifications.get(launch.id)
    // An agent the host tracks is running exactly while its roster says so:
    // a notification may be an earlier run's, since Claude Code notes "the
    // same task-id may notify more than once" when the lead resumes an agent.
    // Orca gives a row a new start at SubagentStart only when the row had
    // left, so a row that started before the notification is the run it
    // ended. A row Orca kept (a stalled run sends no SubagentStop) keeps its
    // first start through a resume; the lead's resume already dropped the
    // notification from before it (`applyAgentResumes`).
    // Not for a named agent or a teammate (`a<name>-<hex>`): Orca only idles
    // such a row at a stop and flips the same row back on a resume, first
    // start and all, so its start says nothing about which run ended.
    const row = launch.kind === 'agent' && roster !== null ? roster.get(launch.id) : undefined
    const endedThisRun =
      row !== undefined && !isTeammateLifecycleId(launch.id) && notification?.timestamp != null && row.startedAt <= notification.timestamp
    const rosterSaysRunning = launch.kind === 'agent' && roster !== null ? row !== undefined && !endedThisRun : null
    if (rosterSaysRunning === true) {
      running.push({ ...launch, status: 'running', elapsedMs: elapsedSince(launch.startedAt, now) })
      continue
    }
    if (notification) {
      const summary = captionOf(notification.summary)
      finished.push({
        at: notification.at,
        task: {
          ...launch,
          status: isFailureStatus(notification.status) ? 'failed' : 'completed',
          elapsedMs: null,
          ...(summary ? { summary } : {}),
          ...(launch.workflow ? { workflow: { ...launch.workflow, usage: notification.usage ?? null } } : {})
        }
      })
      continue
    }
    const judgesShell = launch.kind !== 'agent'
    const verdict = verdictFor(launch, agentSaysRunning, context)
    const launchedBeforeRun =
      judgesShell && runBoundary !== null && launch.startedAt !== null && launch.startedAt < runBoundary
    // Why the time check: on 2026-09-12 two shells launched mid-turn never
    // reached the row. The `run=` the phone held was the previous turn's
    // answer, which could not list shells that did not exist yet, and "not
    // on the list" was read as "finished". An answer given before a launch
    // says nothing about it.
    const answeredBeforeLaunch = verdict.at !== null && launch.startedAt !== null && launch.startedAt > verdict.at
    const hostSaysFinished =
      rosterSaysRunning === false ||
      paneDone ||
      launchedBeforeRun ||
      // The agent's own answer, when it has given one that postdates the launch.
      (judgesShell && verdict.ids !== null && !answeredBeforeLaunch && !verdict.ids.has(launch.id))
    if (hostSaysFinished) {
      finished.push({ at: afterTranscript, task: { ...launch, status: 'completed', elapsedMs: null } })
      continue
    }
    running.push({ ...launch, status: 'running', elapsedMs: elapsedSince(launch.startedAt, now) })
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
  const seenLaunched = new Set(context.reportedLaunched)
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
  for (const id of context.reportedLaunched) {
    if (launches.has(id) || notifications.has(id) || listed.has(id) || paneDone) {
      continue
    }
    // The status line emits `bg=` (launched shells) only when it is non-empty,
    // so once the last shell finishes the phone keeps the previous non-empty
    // list. The `live`/`run` list IS emitted every refresh and is authoritative
    // over what is still running, so a launched id absent from it has finished —
    // even if its completion notification never reached the loaded window. Skip
    // it, or a stale `bg=` id shows a finished shell as running (6 rows for 2
    // live shells, reported 2026-09-14).
    if (agentSaysRunning !== null && !agentSaysRunning.has(id)) {
      continue
    }
    running.push({ id, kind: 'shell', title: id, status: 'running', startedAt: null, elapsedMs: null })
  }
  // A subagent the host is tracking but the loaded transcript window never
  // showed (launched before the page, or its launch record paginated out) —
  // when it is the session's own. A reviewer one of the session's agents
  // started is on the same roster and is not.
  if (roster && !paneDone) {
    for (const [id, snapshot] of roster) {
      if (launches.has(id) || !context.ownedByLead(id)) {
        continue
      }
      // Not `snapshot.startedAt`: that is when the host first saw the
      // subagent, a teammate's creation hours before its current task
      // (device, 2026-09-20; see mobile-subagent-runs.ts).
      const subagentRunStartedAt = context.subagentRuns?.get(id) ?? null
      running.push({
        id,
        kind: 'agent',
        title: truncate(snapshot.description?.trim() || snapshot.agentType?.trim() || id),
        status: 'running',
        startedAt: subagentRunStartedAt,
        elapsedMs: elapsedSince(subagentRunStartedAt, now)
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
  const monitoringAgeMs = context.stateStart === null ? null : now - context.stateStart
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
      startedAt: context.stateStart,
      elapsedMs: elapsedSince(context.stateStart, now)
    })
  }
  // Running stays in launch order (the oldest job is the one people look for);
  // finished is newest-first, by when its notification landed.
  finished.sort((left, right) => right.at - left.at)
  return { running, finished: finished.map((entry) => entry.task) }
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
