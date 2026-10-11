import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── One background agent, launched and left running, Claude Code 2.1.296 ────
//
// Session 0954729d (a hand-started `claude -r codeui`), records 12126–12135
// and 12184–12191, 2026-10-11. Every description, id, timestamp and the launch
// text below is copied from that JSONL. Left out: the Agent call's `prompt` (a
// page of instructions nobody reads off the row), the thinking record (Orca's
// reader drops it), and the hook attachments between the records (Orca's
// reader drops those too).
//
// The shapes that matter:
// - The call says `run_in_background: "true"`, a STRING, as Claude Code wrote it.
// - Its tool_result's `content` is a LIST of one text item, not a string. Orca's
//   reader (`toolResultOutput`) flattens it to the text the phone receives.
// - That result is the launch, written 1.4 s after the call: "Async agent
//   launched successfully." The turn ends six seconds later.
// - The agent finished ten minutes later, at 07:15:46, while the lead was busy
//   with a later turn. Claude Code wrote that completion ONLY as a
//   `queue-operation` enqueue/remove (`absorbed_mid_turn`) and an
//   `attachment`/`queued_command` record. Orca's reader surfaces neither, so the
//   phone never sees this agent finish in the transcript. 42 of the 67
//   background agents of this session ended that way.

export const BACKGROUND_AGENT = {
  description: 'Commands sheet like Claude',
  agentId: 'a7cce30ab64e52712',
  calledAt: '2026-10-11T07:05:06.798Z',
  launchedAt: '2026-10-11T07:05:08.220Z',
  turnEndedAt: '2026-10-11T07:05:14.480Z',
  /** When the agent finished: written only as records the phone never gets. */
  finishedAt: '2026-10-11T07:15:46.542Z'
} as const

/** The launch result's one text item, verbatim. */
export const BACKGROUND_AGENT_LAUNCH_TEXT = `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: a7cce30ab64e52712 (internal ID - do not mention to user. Use SendMessage with to: 'a7cce30ab64e52712', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/0954729d-6205-4368-8185-7c630268f2d0/tasks/a7cce30ab64e52712.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`

/** The tool_result's `content` as the JSONL holds it: a list, not a string. */
export const BACKGROUND_AGENT_LAUNCH_CONTENT = [{ type: 'text', text: BACKGROUND_AGENT_LAUNCH_TEXT }] as const

/** Orca's `toolResultOutput` for a list: each item's text, joined. */
function orcaToolResultOutput(content: readonly { type: string; text: string }[]): string {
  return content.map((item) => item.text).join('\n')
}

const BEFORE =
  "Image #51 is Code UI and #52 is Claude. Starting an agent to make our grouped-commands sheet match Claude's."

const AFTER = `A third agent is now making the "Ran N commands" sheet match Claude's:
- **Height:** opens at half the screen, with the chat still visible above.
- **Flow lines:** a solid line joining each row's icon to the next, ending at the last row. Ours currently shows short, faint dashes.
- **Icon:** Claude's command icon (the bracketed input mark) instead of our terminal square.
- **Text:** commands in a monospace font, with smaller text and a smaller title, as Claude has them.`

/** The records one message each, in file order, the way Orca's reader hands
 *  them to the phone. `withResult: false` stops before the launch result: the
 *  moment the call has been made and not yet answered. */
export function backgroundAgentLaunchMessages({ withResult = true }: { withResult?: boolean } = {}): NativeChatMessage[] {
  const messages: NativeChatMessage[] = [
    {
      id: '96072b30-8af4-44fb-b193-24d004d6e81b',
      role: 'assistant',
      timestamp: Date.parse('2026-10-11T07:04:53.265Z'),
      source: 'transcript',
      blocks: [{ type: 'text', text: BEFORE }]
    },
    {
      id: 'e9cd8f72-ef80-44e5-ad5a-378166bb493c',
      role: 'assistant',
      timestamp: Date.parse(BACKGROUND_AGENT.calledAt),
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Agent',
          input: {
            description: BACKGROUND_AGENT.description,
            subagent_type: 'general-purpose',
            model: 'sonnet',
            isolation: 'worktree',
            run_in_background: 'true'
          }
        }
      ]
    }
  ]
  if (!withResult) {
    return messages
  }
  messages.push(
    {
      id: '3e3e481e-c0dd-4be7-aeba-74373a8e9500',
      role: 'tool',
      timestamp: Date.parse(BACKGROUND_AGENT.launchedAt),
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: orcaToolResultOutput(BACKGROUND_AGENT_LAUNCH_CONTENT) }]
    },
    {
      id: '8fc632ac-fb14-4fbc-bd59-18bd296deb0b',
      role: 'assistant',
      timestamp: Date.parse('2026-10-11T07:05:14.289Z'),
      source: 'transcript',
      blocks: [{ type: 'text', text: AFTER }]
    }
  )
  return messages
}
