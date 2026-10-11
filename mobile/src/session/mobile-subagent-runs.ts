import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { elapsedSince } from './mobile-background-task-captions'

/**
 * When each live subagent's CURRENT run began, as far as the phone has seen.
 *
 * The roster's `startedAt` is when the host first observed the subagent. For
 * an Agent-tool child that is its launch; for a teammate it is its creation,
 * hours before the task it is on now, and the sheet read "13h 16m" beside
 * Claude Code's own "1m 23s" (device, 2026-09-20). The snapshot carries no
 * run start, so the phone keeps its own clock: a subagent it watched go from
 * idle, or absent, to working started then. One it first saw already working
 * has an unknown start — unless the host saw it start only moments earlier,
 * in which case first-observed is the start — and an unknown start is null,
 * drawn as no time at all rather than a number from anywhere else.
 *
 * `null` for the previous clock means this is the first snapshot the phone
 * has seen for the pane; every later call passes the clock back.
 */
export type SubagentRunClock = ReadonlyMap<string, number | null>

/** Within this of the snapshot, first-observed is the start of the run the
 *  host itself just saw begin. Status snapshots reach the phone in seconds. */
const FRESH_START_MS = 60_000

/** What the clock knows of the pane's roster since it last read one. */
export type LastRosterRead = {
  /** Each running row's host start on the last roster read. */
  hostStarts: ReadonlyMap<string, number>
  /** A stand-in hid the roster since: a row may have stopped and come back. */
  unseen: boolean
}

export function observeSubagentRuns(
  previous: SubagentRunClock | null,
  subagents: readonly AgentSubagentSnapshot[] | undefined,
  now: number,
  lastRead?: LastRosterRead
): Map<string, number | null> {
  const next = new Map<string, number | null>()
  for (const snapshot of subagents ?? []) {
    if (snapshot.state === 'idle') {
      continue
    }
    // A row whose host start moved since the last roster read, when a stand-in
    // hid the roster since: it stopped and the lead resumed it by SendMessage
    // (same id; Orca drops a stopped row and stamps its return anew), a new
    // run from that start (the review of b75a42e6, K1: "1h 0m" beside a run
    // of 20 s). A stop the phone sees is a roster without the row, which ends
    // the run anyway. With the roster seen throughout, a moved start is no
    // stop: a nested `claude -p` in the pane makes Orca re-create the lead's
    // running rows with new starts (vendored claude-events.ts), and timed from
    // that the sheet read "30s" beside the desk's "1h 15m" (the cross-branch
    // review of 2f526916 and 163ceb78, which found the same for the task
    // memory). Against the last roster read, not the run the clock kept: the
    // re-created start stays for the rest of the run, and a later stand-in
    // took it for a resume timed from the phone's now, "0s" (the review of
    // 7e632bbb). Only a run whose start the clock knew: one first seen already
    // running stays unknown, as a re-created one would read "30s" (the review
    // of 824b3fdf).
    const lastStart = lastRead?.hostStarts.get(snapshot.id)
    if (
      lastRead?.unseen === true &&
      typeof previous?.get(snapshot.id) === 'number' &&
      typeof lastStart === 'number' &&
      typeof snapshot.startedAt === 'number' &&
      snapshot.startedAt > lastStart
    ) {
      next.set(snapshot.id, snapshot.startedAt)
      continue
    }
    const kept = previous?.get(snapshot.id)
    if (previous?.has(snapshot.id)) {
      next.set(snapshot.id, kept ?? null)
      continue
    }
    const freshlyStarted =
      typeof snapshot.startedAt === 'number' && now - snapshot.startedAt <= FRESH_START_MS
    if (freshlyStarted) {
      next.set(snapshot.id, snapshot.startedAt)
    } else if (previous === null) {
      // Already working when the phone began watching; how long, it cannot say.
      next.set(snapshot.id, null)
    } else {
      // Went from idle or absent to working between two snapshots: now.
      next.set(snapshot.id, now)
    }
  }
  return next
}

/** A launch the run clock saw stop and come back is more than this after
 *  its launch; a first run's roster row starts a moment after the launch call
 *  (SubagentStart 0.1 to 1 s later, fixtures/claude-busy-lead-tasks-2.1.296). */
const RESUMED_RUN_MIN_GAP_MS = 10_000

/** When a launched agent's CURRENT run began: its launch, unless it stopped and
 *  came back. An agent that handed back and was woken (its own shell or reviewer
 *  finished, a message reached it) is timed from the wake, as Claude Code's panel
 *  and the Claude app time it: on 2026-10-11 the sheet read "56m 3s" for an agent
 *  the Claude app showed at "50s", and the row looked like a finished one.
 *  A wake needs both: Orca's row started well after the launch (Orca drops a
 *  stopped one-shot agent's row and stamps its return anew), and the run clock
 *  places the run there. The clock alone is not enough: it stamps a row it first
 *  sees late with that moment, and an agent launched while the chat was closed
 *  read "0s" (review, 2026-10-11). An unknown start keeps the launch. Returns the
 *  start and the time since it. */
export function currentRunStart(
  launchedAt: number | null,
  runStart: number | null | undefined,
  hostStart: number | null | undefined,
  now: number
): { startedAt: number | null; elapsedMs: number | null } {
  const rowRestarted = typeof hostStart === 'number' && (launchedAt === null || hostStart - launchedAt > RESUMED_RUN_MIN_GAP_MS)
  const resumed = rowRestarted && typeof runStart === 'number' && (launchedAt === null || runStart - launchedAt > RESUMED_RUN_MIN_GAP_MS)
  const startedAt = resumed ? runStart : launchedAt
  return { startedAt, elapsedMs: elapsedSince(startedAt, now) }
}
