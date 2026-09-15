import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { hudFieldsFromAgentStatus } from './hud-agent-status-fields'

export type ReportedModelPair = { model: string | null; effort: string | null }

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
  live: { model: string | null; effort: string | null },
  agentStatus: AgentStatusEntry | null | undefined
): ReportedModelPair {
  if (live.model) {
    return { model: live.model, effort: live.effort }
  }
  return {
    model: agentStatus?.model ?? null,
    effort: hudFieldsFromAgentStatus(agentStatus).effort ?? null
  }
}
