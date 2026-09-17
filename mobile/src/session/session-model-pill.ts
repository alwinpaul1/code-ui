import { hasSeenLiveModelReport } from './mobile-native-chat-model-report-authority'

/**
 * The label for the header's model pill, or null when nothing has confirmed it.
 *
 * The pill makes a claim about the world — "this session is running X" — and the
 * only evidence for that is the agent saying so: its own OSC beacon, or the badge
 * on the user's status line. The tracked record is NOT evidence. It is a model
 * somebody picked, which the agent may have refused (Claude puts a confirmation
 * in front of a cached-history switch, and dismissing it leaves the model alone)
 * and which outlives the session that picked it, because the record is keyed by
 * scope and a scope outlives its terminal.
 *
 * Why this is not the 2026-09-15 fix again: that one made a live reading outrank
 * a stale record, which is right and stays. It assumed a live reading would
 * eventually arrive. For a hand-started `claude` none ever does — there is no
 * beacon unless the agent was launched with the flags that write one — so the
 * record stood unchallenged for ever. Seen 2026-09-17 as "Fable"/"Fable Medium"
 * on a session whose transcript holds 1479 turns of claude-opus-5 and not one
 * Fable, which is the same symptom and wording as the note that fix left behind.
 *
 * Showing nothing is the correct answer here, not a degraded one. CLAUDE.md:
 * prefer refusing over guessing, and when a figure cannot be known, show what is
 * known rather than a number from somewhere else. The picker is unaffected — the
 * user can still choose a model; the app just stops asserting which one is live.
 */
export function sessionModelPillLabel(
  label: string | null,
  scopeKey: string | null,
  terminalHandle: string | null
): string | null {
  if (label === null || scopeKey === null) {
    return null
  }
  return hasSeenLiveModelReport(scopeKey, terminalHandle) ? label : null
}
