/**
 * An effort pick the phone sent and the agent has not yet confirmed.
 *
 * Reported 2026-10-13 on 0.9.131 (Claude Code 2.1.296): on a busy Claude tab the
 * user picked High in the model sheet. The sheet's Effort row then read "High"
 * while the composer pill, which reads the agent's own status line, kept reading
 * "Opus 5.5 Medium", and the effort never changed. No transcript of that day has
 * a `/effort` row written mid-turn, or a queue-operation for one, so the command
 * never ran in Claude, and nothing on the phone could notice:
 *
 *  - a pick's write is not checked the way a chat send's is (a command has no
 *    prompt copy to wait for; mobile-native-chat-send-write.ts), so a write the
 *    desktop acked counted as applied;
 *  - the sheet drew the tracked record, a pick of the phone's own, as the value;
 *  - the record never healed, because the report gate refuses a report that
 *    has not changed over a dispatched pick (native-chat-effort-report-gate.ts),
 *    and the agent's Medium never changed;
 *  - nothing read the screen back after the pick, so the next look waited for
 *    the HUD poll (5 s on an idle tab, 1 s on a working one).
 *
 * So a pick is a request, not a fact, until the agent states the value it asked
 * for (its beacon, the badge on the user's own status line, or `/effort`'s own
 * answer in the transcript, whichever the pill already reads). Until then the
 * sheet shows the agent's value and says the change is pending. If the agent
 * still states something else when the window below has passed, the pick is
 * given up and the sheet says so, once.
 *
 * Mid-turn: Claude Code 2.1.296 declares `/effort` `immediate: true` (the
 * command object in the binary), so its prompt runs it while a turn is going,
 * and an effort change re-runs the status line after 300 ms (`effortValue` is in
 * the status line's input list). Older builds queued it: on 2.1.206 a `/effort`
 * typed mid-turn was a `queue-operation enqueue` at 04:32:13Z and ran when the
 * turn ended at 04:35:36Z (a transcript under ~/.claude/projects). A build that
 * queues it draws the command in its queue box, which the phone reads; while the
 * box shows it the pick waits there, unhurried, and Claude itself runs it when
 * the turn ends. The window starts again once the box no longer shows it.
 */
import { effortDisplayLabel } from './mobile-claude-session-catalog'
import type { PickFailureReport } from './session-option-pick-failure'

/** How long a pick may go unconfirmed before it is given up. Claude re-runs
 *  its status line 300 ms after an effort change and, under the HUD launch
 *  flag, every 5 s besides (agent-hud-launch-args.ts); the phone reads the
 *  screen once a second while a pick waits. Ten seconds spans two refresh
 *  beats, so a Medium still stated then is the agent's answer, not lag. */
export const EFFORT_PICK_CONFIRM_MS = 10_000

/** How often the screen is read while a pick waits for its confirmation. */
export const EFFORT_PICK_READ_BACK_MS = 1_000

/** Coming back to a tab whose pick has run out its window, the phone first
 *  reads the screen again: what it holds is the reading from before the user
 *  left, and a queued `/effort` may have run meanwhile. Two reads' worth. */
export const EFFORT_PICK_RETURN_LOOK_MS = 2_000

export type EffortPick = {
  /** The level asked for, as the catalog spells it (`high`). */
  value: string
  /** The model the agent stated when the pick went out. A level is asked of a
   *  model: once the agent states another one, the pick is no longer the
   *  question (a switch resets effort to that model's own), so it is let go
   *  without a word rather than called refused. */
  model?: string | null
  /** When the confirmation window opened: the send, or the last moment the
   *  agent's queue box still showed the command. */
  at: number
  /** Where the pick's failure is said (the drawer, or the chat's banner). */
  report?: PickFailureReport
}

export type EffortPickVerdict =
  | { kind: 'pending'; value: string; queued: boolean; remainingMs: number }
  | { kind: 'dropped'; value: string }
  | { kind: 'confirmed'; value: string }
  | { kind: 'given-up'; value: string; reported: string | null; message: string }

/** Per scope (host + worktree + tab). Module state, like the model pick's: the
 *  hook remounts on every chat/terminal flip and a pick outlives that. */
const picks = new Map<string, EffortPick>()

export function noteEffortPick(scopeKey: string, pick: EffortPick): void {
  picks.set(scopeKey, pick)
}

export function getEffortPick(scopeKey: string): EffortPick | null {
  return picks.get(scopeKey) ?? null
}

export function forgetEffortPick(scopeKey: string): void {
  picks.delete(scopeKey)
}

export function clearEffortPicksForTests(): void {
  picks.clear()
}

/** The catalog's level ids are the agent's own words (low, medium, high, xhigh,
 *  max), so a statement confirms a pick when the words match. */
function sameLevel(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The command a pick types, as Claude draws it in its queue box. */
function queuedThere(value: string, queued: readonly string[]): boolean {
  const command = `/effort ${value}`.toLowerCase()
  return queued.some((row) => row.trim().toLowerCase() === command)
}

/** What is said, once, when a pick is given up. Levels are named as the pill
 *  names them (effortDisplayLabel: `xhigh` is "Extra"). */
export function effortPickGivenUpMessage(value: string, reported: string | null): string {
  const label = effortDisplayLabel
  return reported
    ? `Effort is still ${label(reported)}: the agent did not take ${label(value)}. Try again.`
    : `Sent ${label(value)}, but the agent has not said its effort, so the change is not confirmed.`
}

/**
 * Where a pick stands, given what the agent states now. Pure apart from the
 * window restarting while the queue box shows the command, which it writes back
 * to the pick so the next look counts from there.
 */
export function judgeEffortPick(
  pick: EffortPick,
  input: {
    reportedEffort: string | null
    /** The model the agent states now, or null when it states none. */
    reportedModel?: string | null
    queuedMessages: readonly string[]
    now: number
  }
): EffortPickVerdict {
  const { reportedEffort, now } = input
  if (sameLevel(reportedEffort, pick.value)) {
    return { kind: 'confirmed', value: pick.value }
  }
  if (pick.model && input.reportedModel && input.reportedModel !== pick.model) {
    return { kind: 'dropped', value: pick.value }
  }
  const queued = queuedThere(pick.value, input.queuedMessages)
  if (queued) {
    pick.at = now
  }
  const remainingMs = pick.at + EFFORT_PICK_CONFIRM_MS - now
  if (remainingMs > 0) {
    return { kind: 'pending', value: pick.value, queued, remainingMs }
  }
  return {
    kind: 'given-up',
    value: pick.value,
    reported: reportedEffort,
    message: effortPickGivenUpMessage(pick.value, reportedEffort)
  }
}
