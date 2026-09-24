import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── Five agents launched in one turn, as Claude Code 2.1.281 wrote them ─────
//
// Session 967668df, records 8947–8978, 2026-09-23 23:34–23:35 UTC: the turn
// the Claude app drew as "Running agent" with a "Ran 5 agents" sheet (the
// recordings of 2026-09-24). Every description, timestamp, agent id and
// result below is copied from that JSONL. Two things are left out: each
// Agent call's `prompt` (a page of instructions nobody reads off the row),
// and the thinking record before the text, which Orca's reader drops.
//
// The point of the fixture is the ORDER. Claude Code writes the five launch
// results when the launches are acknowledged, not in the order it made the
// calls: the 4th call's result comes first, then the 2nd, 1st, 3rd, 5th.
// The phone pairs calls with results first-in-first-out, because Orca's
// reader drops the tool_use ids, so three of the five pair with the wrong
// agent.

export const PARALLEL_AGENTS = [
  { description: "Keep phone's own message copy", agentId: 'ad17a815f19b6f5ae', at: '2026-09-23T23:35:01.914Z' },
  { description: 'Tool row labels and line counts', agentId: 'a2da9e3215ab10f26', at: '2026-09-23T23:35:15.826Z' },
  { description: 'File cards for uploaded files', agentId: 'a9e5009c8ad4d9b1b', at: '2026-09-23T23:35:27.808Z' },
  { description: 'Composer clears text and media together', agentId: 'accf64d0f1887be75', at: '2026-09-23T23:35:36.559Z' },
  { description: 'Stop showing Working after API error', agentId: 'a9ec8b60590cd42b1', at: '2026-09-23T23:35:48.543Z' }
] as const

/** The launch results in the order the transcript holds them. */
const RESULTS = [
  { agentId: 'accf64d0f1887be75', at: '2026-09-23T23:35:54.491Z' },
  { agentId: 'a2da9e3215ab10f26', at: '2026-09-23T23:35:54.529Z' },
  { agentId: 'ad17a815f19b6f5ae', at: '2026-09-23T23:35:54.552Z' },
  { agentId: 'a9e5009c8ad4d9b1b', at: '2026-09-23T23:35:54.565Z' },
  { agentId: 'a9ec8b60590cd42b1', at: '2026-09-23T23:35:54.585Z' }
] as const

export const PARALLEL_AGENTS_TEXT = `Doing the rest. To keep things moving, I'm splitting it across five agents, each in its own isolated copy of the repo, and I'll review and merge each one myself:
- **A:** keep the phone's own copy of a message (images and position)
- **B:** tool row labels and line counts
- **C:** file cards for uploads
- **D:** text and media leaving the input box together
- **E:** "Working" still showing after an API error

I'll take the thinking side line and the background-tasks recording myself.`

export function asyncAgentLaunchResult(agentId: string): string {
  return `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: ${agentId} (internal ID - do not mention to user. Use SendMessage with to: '${agentId}', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d/tasks/${agentId}.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`
}

/** A finished agent's notification, shaped like record 528 of the same
 *  session (an agent of 2026-09-23 09:17 UTC), with its long <result> cut. */
export function agentFinishedNotification(agentId: string, description: string): string {
  return `<task-notification>
<task-id>${agentId}</task-id>
<tool-use-id>toolu_01TvnbjxQzvv37AgD1KPUwme</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d/tasks/${agentId}.output</output-file>
<status>completed</status>
<summary>Agent "${description}" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>
<result>Batch A is done.</result>
<usage><subagent_tokens>258803</subagent_tokens><tool_uses>52</tool_uses><duration_ms>964319</duration_ms></usage>
</task-notification>`
}

/** The records one message each, in file order, the way Orca's reader hands
 *  them to the phone. */
export function parallelAgentMessages(): NativeChatMessage[] {
  return [
    {
      id: '16673dfc-a5d9-4373-96ef-034e610c897f',
      role: 'assistant',
      timestamp: Date.parse('2026-09-23T23:34:46.482Z'),
      source: 'transcript',
      blocks: [{ type: 'text', text: PARALLEL_AGENTS_TEXT }]
    },
    ...PARALLEL_AGENTS.map(
      (agent, index): NativeChatMessage => ({
        id: `agent-call-${index + 1}`,
        role: 'assistant',
        timestamp: Date.parse(agent.at),
        source: 'transcript',
        blocks: [
          {
            type: 'tool-call',
            name: 'Agent',
            input: {
              description: agent.description,
              subagent_type: 'general-purpose',
              isolation: 'worktree',
              run_in_background: 'true'
            }
          }
        ]
      })
    ),
    ...RESULTS.map(
      (result, index): NativeChatMessage => ({
        id: `agent-result-${index + 1}`,
        role: 'user',
        timestamp: Date.parse(result.at),
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: asyncAgentLaunchResult(result.agentId) }]
      })
    )
  ]
}
