import type { AgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import { matchNativeChatCatalogModelId } from '../../../src/shared/native-chat-session-option-state'

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

/** Terminals whose agent has already stated its own model.
 *
 *  Keyed by scope AND handle, because a scope — host + worktree + tab — outlives
 *  the terminal inside it. Keyed by scope alone, a tab that got a new terminal
 *  kept this latched from the DEAD one and threw away the new agent's launch
 *  record, so the pill stated the model of a terminal that no longer existed.
 *  That is the same failure the handle-keyed sticky hold fixes, reached through
 *  this door instead (2026-09-15). */
const sawLiveByTerminal = new Set<string>()

function terminalKey(scopeKey: string, handle: string | null): string {
  return `${scopeKey}\u0000${handle ?? ''}`
}

export function noteLiveModelReport(scopeKey: string, handle: string | null): void {
  sawLiveByTerminal.add(terminalKey(scopeKey, handle))
}

export function hasSeenLiveModelReport(scopeKey: string, handle: string | null): boolean {
  return sawLiveByTerminal.has(terminalKey(scopeKey, handle))
}

/** Forget every terminal of a scope — the agent under it changed, or the scope
 *  was evicted. */
export function forgetLiveModelReport(scopeKey: string): void {
  const prefix = `${scopeKey}\u0000`
  for (const key of sawLiveByTerminal) {
    if (key.startsWith(prefix)) {
      sawLiveByTerminal.delete(key)
    }
  }
}

/** The report key last APPLIED per scope. Gates the LAUNCH record only, which
 *  repeats itself unchanged on every tab re-entry and reconnect. It used to gate
 *  live readings too, on the premise that mobile cannot read the agent's screen
 *  — no longer true, and that premise is what froze the pill on a model the
 *  session never ran (2026-09-15). */
const appliedByScope = new Map<string, string>()

export function lastAppliedReport(scopeKey: string): string | undefined {
  return appliedByScope.get(scopeKey)
}

export function noteAppliedReport(scopeKey: string, reportKey: string): void {
  appliedByScope.set(scopeKey, reportKey)
}

/** Drop everything this module remembers about one scope: called when the agent
 *  under a tab changes, and when a scope is evicted. Three caches had to be
 *  cleared in step and were not, which is how a new agent inherited the old
 *  one's model (2026-09-15). One call now, so they cannot drift apart. */
export function forgetModelReportScope(scopeKey: string): void {
  appliedByScope.delete(scopeKey)
  pendingByScope.delete(scopeKey)
  forgetLiveModelReport(scopeKey)
}

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
  appliedByScope.clear()
  pendingByScope.clear()
  sawLiveByTerminal.clear()
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
  /** Whether a LIVE reading has already been applied for this scope. */
  sawLive: boolean
  now: number
}): ModelReportDecision {
  const { source, reported, lastAppliedKey, reportKey, pendingPick, sawLive, now } = input
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
  // Once the agent has stated its own model for this session, what it was
  // LAUNCHED as says nothing further about it. Without this the pill flipped
  // back and forth: a live reading holds while the agent works, the reading
  // stops when the turn ends, and the launch record — differing, so counting as
  // "changed" — overwrote the truth. Reported 2026-09-15 as the model coming
  // "back randomly when the response ends".
  if (sawLive) {
    return 'skip'
  }
  // Before then, the launch record is all there is: only a value that CHANGED
  // is new evidence, because the same one is re-delivered on every tab re-entry
  // and reconnect.
  return lastAppliedKey === reportKey ? 'skip' : 'apply'
}


/**
 * Resolve a raw model report into the catalog id to seed, and decide whether it
 * may be applied — with all the per-scope bookkeeping the decision implies.
 *
 * It lives here rather than in the hook because every cache it touches lives
 * here: the applied-report latch, the pending pick, and the record of which
 * terminals have spoken. Keeping the decision next to the state it reads is
 * what stops those three drifting apart, which is how a new agent came to
 * inherit the old one's model (2026-09-15).
 *
 * `matched` comes back even when the answer is "do not apply", because it is
 * also what the agent is CURRENTLY reporting, and a pick dispatched later needs
 * to stamp that on itself.
 */
export function resolveReportedModelSeed(input: {
  catalog: AgentSessionOptionCatalog
  agent: string
  reportedModel: string
  reportedEffort: string | null
  source: ModelReportSource
  scopeKey: string
  terminalHandle: string | null
}): { matched: string; apply: boolean } | null {
  const { catalog, agent, reportedModel, reportedEffort, source, scopeKey, terminalHandle } = input
  // Codex's lineup (gpt-6-astra, …) outpaces the catalog, so track a reported id
  // it does not list as the raw model; `withTrackedNativeChatModel` then names
  // it in the pill. OMP reports exact `provider/id` selectors, including ones
  // absent from cached discovery, and those are what its CLI accepts back — so
  // it never goes through the catalog match, whose longest-prefix rule would
  // fold `deepseek/deepseek-v4-pro-new` onto `…-v4-pro` (Orca #20612). Claude
  // keeps the strict match — its badge label "Opus 5" is not a catalog id.
  const matched =
    agent === 'omp'
      ? reportedModel.trim() || null
      : (matchNativeChatCatalogModelId(catalog, reportedModel) ??
        (agent === 'codex' ? reportedModel.trim() : null))
  if (!matched) {
    return null
  }
  const reportKey = reportedEffort ? `${matched}\u0000${reportedEffort}` : matched
  const decision = decideModelReport({
    source,
    reported: matched,
    lastAppliedKey: lastAppliedReport(scopeKey),
    reportKey,
    pendingPick: getPendingModelPick(scopeKey),
    sawLive: hasSeenLiveModelReport(scopeKey, terminalHandle),
    now: Date.now()
  })
  if (decision === 'skip') {
    return { matched, apply: false }
  }
  clearPendingModelPick(scopeKey)
  if (source === 'live') {
    noteLiveModelReport(scopeKey, terminalHandle)
  }
  noteAppliedReport(scopeKey, reportKey)
  return { matched, apply: true }
}
