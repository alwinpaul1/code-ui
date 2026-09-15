/**
 * Whether a model report is allowed to overwrite what the record already says.
 *
 * Two sources reach this decision and they are not equally good evidence:
 *
 * - `'live'` — the agent's own OSC beacon, or the badge on a user's own status
 *   line. This is what the agent IS, on the repaint it said it. It is re-read
 *   continuously, so the same value arriving twice is two statements, not one
 *   echoed twice.
 * - `'launch'` — the host's `agentStatus.model`, which is what the session was
 *   STARTED as. It is re-delivered whenever the tab is re-entered or the status
 *   stream reconnects, and it cannot have observed a `/model` sent after it.
 *
 * The old rule applied the launch treatment to both: a report equal to the last
 * one applied was ignored outright. That froze the pill. If a model pick was
 * dispatched and the agent never honoured it — Claude puts up a confirmation
 * for a cached-history switch, and dismissing it leaves the model alone — the
 * record kept the pick, the agent went on reporting the same unchanged model,
 * and because that report never CHANGED it was never applied again. The pill
 * stated a model the session had never run, and remounting did not clear it
 * because the latch is module-level. Reported 2026-09-15 as "it shows sometimes
 * wrong model"; seen earlier as "Fable Medium" on an Opus 5 session.
 *
 * So a live reading always wins. The one exception is the moment just after a
 * pick is dispatched, when the agent has been asked to switch but has not
 * repainted yet: for a short grace period the pick stands, so the pill does not
 * flicker back to the old model and then forward to the new one. The grace only
 * ever DELAYS a correction — once it passes, the agent's own word wins — so it
 * cannot produce a pill that lies indefinitely, which is the failure it
 * replaces.
 */
export type ModelReportSource = 'live' | 'launch'

/** Claude repaints its status line within about a second of a slash command,
 *  so a switch that is going to happen has reported itself long before this.
 *  Generous on purpose: overshooting costs a late correction, undershooting
 *  costs a visible flicker on every successful model change. */
export const MODEL_PICK_GRACE_MS = 6000

export type ModelReportDecision = 'apply' | 'skip'

export type PendingModelPick = { model: string; at: number; wasReporting: string | null }

/** Picks dispatched to an agent and not yet echoed back by it, per scope.
 *  Module-level for the same reason the applied-report latch is: it has to
 *  outlive the component, which remounts on every chat/terminal flip. */
const pendingByScope = new Map<string, PendingModelPick>()

export function notePendingModelPick(
  scopeKey: string,
  model: string,
  wasReporting: string | null
): void {
  pendingByScope.set(scopeKey, { model, at: Date.now(), wasReporting })
}

export function getPendingModelPick(scopeKey: string): PendingModelPick | null {
  return pendingByScope.get(scopeKey) ?? null
}

/** The agent has spoken past the pick: settled, whichever way it went. */
export function clearPendingModelPick(scopeKey: string): void {
  pendingByScope.delete(scopeKey)
}

export function clearPendingModelPicksForTests(): void {
  pendingByScope.clear()
}

export function decideModelReport(input: {
  source: ModelReportSource
  /** The catalog id the report resolves to. */
  reported: string
  /** The same key the previous applied report was stored under, or undefined. */
  lastAppliedKey: string | undefined
  /** The key this report would be stored under. */
  reportKey: string
  /** A model pick dispatched locally and not yet confirmed by the agent.
   *  `wasReporting` is what the agent was reporting when it was dispatched. */
  pendingPick: PendingModelPick | null
  now: number
}): ModelReportDecision {
  const { source, reported, lastAppliedKey, reportKey, pendingPick, now } = input
  // A pick the agent has been asked for but has not had time to report yet.
  // Holding it briefly is what keeps a successful switch from flickering.
  //
  // Only while the agent has not MOVED, though — the report still being the
  // value it had when the pick went out is what "hasn't caught up yet" looks
  // like. A report naming anything else is news, whether or not it is the pick,
  // and news is never withheld.
  if (
    pendingPick &&
    pendingPick.model !== reported &&
    reported === pendingPick.wasReporting &&
    now - pendingPick.at < MODEL_PICK_GRACE_MS
  ) {
    return 'skip'
  }
  if (source === 'live') {
    return 'apply'
  }
  // The launch record: only a value that CHANGED is new evidence, because the
  // same one is re-delivered on every tab re-entry and reconnect.
  return lastAppliedKey === reportKey ? 'skip' : 'apply'
}
