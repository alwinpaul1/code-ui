/**
 * A beacon dies with its process.
 *
 * The beacon store is keyed by terminal handle, and a handle outlives the
 * process that emitted into it. On 2026-09-18 the phone read "Fable 5.1
 * medium" for a terminal whose process was a hand-started `claude -c`
 * painting "[Opus 5 (1M context) xhigh]": the phone-launched agent that had
 * run there before had left its last beacon in the store, the hand-started one
 * emits none (no `--settings`), and — verified on Claude Code 2.1.276 — `-c`
 * and `--resume` keep the SAME session id, so the session check alone cannot
 * tell the two apart. What can is silence.
 *
 * Two facts about a live, phone-launched agent, and one rule each:
 *
 *  - Claude Code repaints its status line several times a second while it
 *    works, and every repaint re-emits the beacon. So a beacon that stays
 *    silent through `BEACON_WORKING_SILENCE_MS` of the agent WORKING is from a
 *    process that is no longer painting. Idle time does not count — an idle
 *    agent does not repaint — and neither does time spent blocked on a
 *    permission dialog or a question, where the status line sits still too.
 *  - Both agents beacon when a turn ENDS: Codex runs its notify command then
 *    and only then, and Claude's Stop hook fires there beside the repaint. So
 *    a turn that ends and brings no beacon within `BEACON_TURN_END_GRACE_MS`
 *    is a turn the emitting process did not see. This is the only rule on the
 *    Codex lane, where working silence proves nothing.
 *
 * "Arrived" means arrived THIS RUN. A warm-start record restored from disk is
 * not an arrival, so the first working stretch after a cold start is measured
 * in full.
 *
 * Pure: the hook in `use-agent-hud-beacon-liveness.ts` owns the clock.
 */

/** Working silence after which a Claude beacon is dead. */
export const BEACON_WORKING_SILENCE_MS = 30_000
/** How long after a turn ends a beacon may still arrive and count for it. A
 *  Codex notify reads the whole rollout with sed first, and both agents'
 *  beacons ride the same relay as the status flip that marks the turn end. */
export const BEACON_TURN_END_GRACE_MS = 20_000
/** A beacon that landed this long BEFORE the status flip is the turn-end
 *  beacon arriving ahead of it, not an earlier one. */
export const BEACON_TURN_END_SLACK_MS = 10_000

/** What the tab's agent is doing, as far as repainting goes: `working`
 *  repaints, `paused` (blocked on a dialog, waiting on a question) does not
 *  and is not a turn end, `idle` is what a turn ends into. */
export type BeaconPhase = 'working' | 'paused' | 'idle'

export type BeaconWatch = {
  /** The arrival this watch has counted from; null: none this run. */
  arrivedAt: number | null
  /** Working time with no arrival, over stretches already ended (ms). */
  silentWorkedMs: number
  /** When the current working stretch began, or null outside one. */
  workingSince: number | null
  /** When the last turn ended with no arrival since, or null. */
  turnEndedAt: number | null
  /** The phase last observed, so the step into `idle` is seen as a turn end
   *  whether it comes from working or from a dialog the user answered. */
  phase: BeaconPhase
}

export const NEW_BEACON_WATCH: BeaconWatch = {
  arrivedAt: null,
  silentWorkedMs: 0,
  workingSince: null,
  turnEndedAt: null,
  phase: 'idle'
}

export function stepBeaconWatch(
  watch: BeaconWatch,
  input: { now: number; phase: BeaconPhase; arrivedAt: number | null }
): BeaconWatch {
  let next = watch
  if (input.arrivedAt !== null && (next.arrivedAt === null || input.arrivedAt > next.arrivedAt)) {
    // A fresh beacon: the process is painting. Count from here, and only the
    // part of a stretch already under way that came after it.
    next = {
      ...next,
      arrivedAt: input.arrivedAt,
      silentWorkedMs: 0,
      workingSince:
        next.workingSince === null ? null : Math.max(next.workingSince, input.arrivedAt),
      turnEndedAt: null
    }
  }
  const working = input.phase === 'working'
  if (working && next.workingSince === null) {
    next = { ...next, workingSince: input.now }
  } else if (!working && next.workingSince !== null) {
    next = {
      ...next,
      silentWorkedMs: next.silentWorkedMs + Math.max(0, input.now - next.workingSince),
      workingSince: null
    }
  }
  if (input.phase === 'idle' && watch.phase !== 'idle') {
    // The turn is over: it went idle from working, or from a dialog.
    next = { ...next, turnEndedAt: input.now }
  }
  return next.phase === input.phase ? next : { ...next, phase: input.phase }
}

/** Whether the beacon this watch follows is still believed, and when to look
 *  again (null: nothing pending, no timer needed). */
export function beaconWatchVerdict(
  watch: BeaconWatch,
  agent: string | null,
  now: number
): { live: boolean; recheckAt: number | null } {
  // Codex only beacons at a turn's end; silence mid-turn is what it does.
  const countsSilence = agent !== 'codex'
  const silent =
    watch.silentWorkedMs + (watch.workingSince !== null ? Math.max(0, now - watch.workingSince) : 0)
  if (countsSilence && silent >= BEACON_WORKING_SILENCE_MS) {
    return { live: false, recheckAt: null }
  }
  if (
    watch.turnEndedAt !== null &&
    now - watch.turnEndedAt >= BEACON_TURN_END_GRACE_MS &&
    (watch.arrivedAt === null || watch.turnEndedAt - watch.arrivedAt > BEACON_TURN_END_SLACK_MS)
  ) {
    return { live: false, recheckAt: null }
  }
  const deadlines: number[] = []
  if (countsSilence && watch.workingSince !== null) {
    deadlines.push(watch.workingSince + (BEACON_WORKING_SILENCE_MS - watch.silentWorkedMs))
  }
  if (watch.turnEndedAt !== null) {
    deadlines.push(watch.turnEndedAt + BEACON_TURN_END_GRACE_MS)
  }
  return { live: true, recheckAt: deadlines.length > 0 ? Math.min(...deadlines) : null }
}

/** One watch per terminal handle, at MODULE scope like the beacon store it
 *  follows: the chat view is torn down and rebuilt on every chat/terminal flip
 *  and route change, and a watch that reset with it would never reach its
 *  window. Oldest shed first. */
const watches = new Map<string, BeaconWatch>()
const BEACON_WATCH_CAP = 32

export function readBeaconWatch(handle: string): BeaconWatch {
  return watches.get(handle) ?? NEW_BEACON_WATCH
}

export function writeBeaconWatch(handle: string, watch: BeaconWatch): void {
  watches.delete(handle)
  watches.set(handle, watch)
  while (watches.size > BEACON_WATCH_CAP) {
    const oldest = watches.keys().next().value
    if (oldest === undefined) {
      break
    }
    watches.delete(oldest)
  }
}

/** With the beacon store: the handles are gone, and so is what was watched. */
export function resetBeaconWatches(): void {
  watches.clear()
}
