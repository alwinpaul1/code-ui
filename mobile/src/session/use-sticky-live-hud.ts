import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

type Held = {
  model: string | null
  /** The agent's own name for the held model; null when it stated none. */
  label: string | null
  effort: string | null
  context: TerminalHudContextWindow | null
}

/** What each tab+terminal last stated, kept at MODULE scope.
 *
 *  Not a ref: a ref belongs to one component instance, and this view is torn
 *  down and rebuilt on every chat/terminal flip and route change. The caches it
 *  sits beside — the option records, the applied-report latch, the beacon store
 *  — are all module-level for that reason, and a hold that did not match them
 *  meant the pill fell back to the LAUNCH model the moment the view remounted.
 *  Reported 2026-09-15: the pill "switches automatically when i send a message
 *  and comes back randomly when the response ends". */
const heldByScope = new Map<string, Held>()

/** One per open tab is plenty; oldest shed first. */
const STICKY_LIVE_HUD_CAP = 32

/** The last terminal each tab was actually known to have.
 *
 *  `activeHandle` is React state and dips to null while a tab is resolving its
 *  terminal — `use-mobile-session-tab-application.ts` nulls it whenever the
 *  active tab's `terminal` is not a string, which that type allows. Treating a
 *  null as its own scope threw the whole hold away, the context ring with it,
 *  on a tab that had not changed at all; a blank ring is exactly what was
 *  reported and fixed in 0.5.99, so it must not come back by this door. */
const lastHandleByTab = new Map<string, string>()

/** The last session each tab+terminal was known to be showing, for the same
 *  reason: `activeChatSessionId` is derived from the host's provider-session
 *  row and dips to null while a tab resolves. Null is "not known yet", never
 *  "a different session". */
const lastSessionByScope = new Map<string, string>()

export function clearStickyLiveHudForTests(): void {
  heldByScope.clear()
  lastHandleByTab.clear()
  lastSessionByScope.clear()
}

export type StickyLiveHud = {
  model: string | null
  label: string | null
  effort: string | null
  context: TerminalHudContextWindow | null
}

/**
 * The last model, effort and context the SCREEN stated, held per tab, terminal
 * and session across screen reads that come back empty.
 *
 * Only the screen: the `[Model effort]` badge on a user's own status line, or
 * Codex's footer. The agent's OSC beacon is the other live source, and it is
 * NOT held here — the beacon store already keeps the last beacon per handle,
 * and it is that store, not this hold, that decides when a beacon has died
 * with its process (`agent-hud-beacon-liveness.ts`). Holding beacon figures
 * here as well would have kept a dead process's model on the pill after the
 * store had let it go. `useMobileNativeChatHud` applies this hold to the raw
 * screen reading BEFORE merging the beacon in, so nothing from a beacon can
 * enter it. The pill's only other candidate, the launch-time
 * `agentStatus.model`, is not a model source at all
 * (`mobile-chat-reported-model.ts`).
 *
 * Why it matters: on a session whose `terminal.read` lags (a 301 MB transcript,
 * 2026-09-14) the observation alternated between real figures and nothing, so
 * the pill flipped between "Opus xhigh" — what the session actually is — and
 * "Fable Medium" — what it was LAUNCHED as, long since changed by `/model`.
 * The context ring blanked on the same ticks. A figure the agent has stated is
 * better evidence than the launch record for as long as this tab is open, so an
 * empty observation keeps it rather than falling back.
 *
 * Reset when the tab, its terminal OR its session changes: these figures
 * belong to one session of one agent process. Keying on the tab alone was
 * wrong because a tab that kept its id and got a new terminal went on stating
 * the previous agent's model (a PTY restart, a reconnect, and
 * `use-mobile-session-close-actions.ts:86`, which hands the active handle to a
 * replacement terminal without touching the tab id). Keying on tab and handle
 * was still wrong because the PROCESS changes under a handle too: on
 * 2026-09-18 a `claude` typed by hand into a terminal that had run a
 * phone-launched agent kept that agent's held figures, and on a host with no
 * status line nothing ever came to replace them. The session id is what
 * separates the two, and a new session under the same handle starts empty.
 */
export function useStickyLiveHud(
  observation: {
    modelId: string | null
    /** The agent's OWN name for it ("Opus 4.8.5"), held beside the id so the
     *  pill can state the model actually running rather than the family the id
     *  collapses to. Travels with the id; never held on its own. */
    modelLabel?: string | null
    effort: string | null
    context?: TerminalHudContextWindow | null
  } | null,
  tabId: string | null,
  handle: string | null,
  sessionId: string | null
): StickyLiveHud {
  const tab = tabId ?? ''
  if (handle) {
    lastHandleByTab.set(tab, handle)
  }
  // A null handle is "not known yet", never "a different terminal".
  const known = handle ?? lastHandleByTab.get(tab) ?? ''
  const scope = `${tab}\u0000${known}`
  if (sessionId) {
    lastSessionByScope.set(scope, sessionId)
  }
  // Likewise a null session id; see `lastSessionByScope`.
  const session = sessionId ?? lastSessionByScope.get(scope) ?? ''
  const key = `${scope}\u0000${session}`
  const held = heldByScope.get(key) ?? { model: null, label: null, effort: null, context: null }
  // Delete-then-set on every READ, so the scope being looked at becomes the
  // most recent and eviction only ever sheds the oldest UNTOUCHED one. Setting
  // it once on first sight made this FIFO, and a Map iterates in insertion
  // order — so the tab the user had open all session was the oldest key and the
  // first thrown away, while dead handles (one per PTY restart or reconnect)
  // filled the cap. Losing the entry drops the pill back to the launch model,
  // which is the whole failure this hold exists to prevent. `getScopedRecord`
  // in `use-mobile-native-chat-session-options.ts` states the same rule.
  heldByScope.delete(key)
  heldByScope.set(key, held)
  while (heldByScope.size > STICKY_LIVE_HUD_CAP) {
    const oldest = heldByScope.keys().next().value
    if (oldest === undefined) {
      break
    }
    heldByScope.delete(oldest)
  }
  // Model and effort move TOGETHER, from the reading that names the model.
  //
  // An effort with no model behind it is not a statement about this session's
  // model: `applyAgentStatusHudFields` builds exactly that observation — a null
  // model carrying the host's `agentStatus.effort` — whenever the screen read
  // comes back empty, which on a host with no status line is every tick. Taking
  // it alone welded a launch-time effort onto a model read somewhere else, and
  // the pill stated a pair that never existed ("Opus Medium" on Opus xhigh).
  // The reading that names the model owns the effort beside it, null included.
  if (observation?.modelId) {
    held.model = observation.modelId
    held.label = observation.modelLabel ?? null
    held.effort = observation.effort
  }
  if (observation?.context) {
    held.context = observation.context
  }
  return { model: held.model, label: held.label, effort: held.effort, context: held.context }
}
