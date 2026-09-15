import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { ModelReportSource } from './mobile-native-chat-model-report-authority'

export type ReportedModelPair = {
  model: string | null
  /** The agent's OWN name for it ("Opus 4.8.5"), for stating what is running
   *  rather than the catalog family the id collapses to. Never present without
   *  a model: a name alone says nothing about this session. */
  label: string | null
  effort: string | null
  /** Which of the two sources answered; they are not equal evidence. See
   *  `mobile-native-chat-model-report-authority.ts`. */
  source: ModelReportSource
}

/**
 * The model the chat pill states, and the effort that belongs TO IT.
 *
 * The two travel together or not at all. They come from two sources that must
 * never be mixed: what the agent has said about itself this session (the OSC
 * beacon, or the badge on a user's own status line, held by `useStickyLiveHud`),
 * and the host's `agentStatus` record, which is what the session was LAUNCHED
 * as and does not follow a `/model` typed into the agent.
 *
 * Taking the model from one and the effort from the other is how the pill came
 * to state a pair that never existed — "Opus Medium" on a session running Opus
 * at extra-high effort (reported 2026-09-15). A live model outranks the launch
 * record, so when there is one it brings its own effort, null included; only
 * when the agent has said nothing yet does the launch record answer, and then
 * it answers for both.
 */
export function reportedModelPair(
  live: { model: string | null; label?: string | null; effort: string | null },
  /** Kept in the signature, and deliberately unread: it is where the launch
   *  record arrives, and the point of this function is that the launch record
   *  is not a model source. Dropping the parameter would hide that decision at
   *  every call site. */
  _agentStatus?: AgentStatusEntry | null
): ReportedModelPair {
  if (live.model) {
    return { model: live.model, label: live.label ?? null, effort: live.effort, source: 'live' }
  }
  // Nothing, rather than the launch record.
  //
  // Orca writes `agentStatus.model` once, when the session starts, and never
  // updates it for a `/model` typed afterwards — so on any session whose model
  // has been changed it is not stale by accident, it is wrong by construction.
  // Every wrong reading reported on 2026-09-15 traced back to it, through a
  // different door each time: held figures evicted, a latch keyed too widely, a
  // fresh process with no beacon yet. Each fix closed one door and the next
  // opened another, because the wrong value was still sitting there waiting.
  //
  // So it is no longer a model source. The pill states what the agent has said
  // about itself — its own beacon, or the badge on the user's status line — or
  // it states nothing for the second before the agent speaks. The project's own
  // rule, and the reason it exists: show nothing rather than a figure from
  // somewhere else.
  return { model: null, label: null, effort: null, source: 'launch' }
}
