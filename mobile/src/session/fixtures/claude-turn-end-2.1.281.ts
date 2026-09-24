import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// Two lead turns that ended while a background agent this session had launched
// was still running, as Code UI receives them. Every string is copied verbatim
// out of Claude Code 2.1.281's own transcript of session 967668df
// (`~/.claude-work/projects/-Users-alwinpaul-Desktop-Project-Code-UI/`, read
// 2026-09-24); ids are the records' uuids and timestamps their own. Only the
// Agent prompts and the Bash command are cut short: nothing reads them.

/** Line 8327, 23:01:14.795Z: the assistant record Claude Code wrote with
 *  `isApiErrorMessage: true` and `error: "invalid_request"`. No status code:
 *  a safeguards refusal is not an HTTP failure. */
export const SAFEGUARDS_API_ERROR_TEXT =
  "API Error: Opus 5.5 (1M context)'s safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. Claude Code can't respond to this message with Opus 5.5 (1M context).\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nSend feedback with /feedback or learn more: https://support.claude.com/en/articles/8106465\n\nDetails: `[reasoning_extraction]`\n\nRequest ID: req_011CfMCj7pRufX6xL1gRrCuR"

/** Line 7323, 21:57:09.137Z, `stop_reason: "end_turn"`, followed by the Stop
 *  hook and a `turn_duration` record saying `pendingBackgroundAgentCount: 1`. */
export const STOP_REPLY_TEXT =
  "I've fixed all three Windows problems from your recording, and the gate is green: 1168 files, 11,934 tests, PowerShell tests included. A second reviewer is checking the diff, and I'll commit once it clears.\n\n- **The PC is named correctly.** Failure messages now say \"The PC did not answer.\", \"The PC refused the command.\" or \"The PC did not finish that.\" In your recording the \"Mac\" wording came from the step that opens the terminal on the desktop, and it now uses the host's own noun. The test failed first with the exact text from your recording.\n- **An offline PC shows no controls.** Host 1 was offline in the recording. The sheet still offered all five rows, and each tap could only fail. An offline PC now shows one disabled row, \"PC offline · connect first\", and the Mac does the same. When the PC reconnects with the sheet open, the phone checks its state again.\n- **The display state is read.** The PC's check now also asks Windows whether its display is on, off or dimmed. On shows only Sleep display, off shows only Wake display, and dimmed counts as on. Mute was already read the same way, so it shows one row once the PC is connected.\n\nThe display and mute checks haven't run on a real Windows PC yet. PowerShell 7 on this Mac parses the scripts and compiles the new display check, but the Windows calls themselves can only fail here. If Windows doesn't answer within a second, the sheet falls back to showing both display rows, as it does today. Once this is on your phone, open the sheet with the PC connected, once with the display on and once with it off, to confirm.\n\nsession:ok"

const agentLaunchResult = (id: string) =>
  `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: ${id} (internal ID - do not mention to user. Use SendMessage with to: '${id}', summary: '<5-10 word recap>' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.\nDo not duplicate this agent's work — avoid working with the same files or topics it is using.\noutput_file: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d/tasks/${id}.output\nDo NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`

function row(
  id: string,
  role: NativeChatMessage['role'],
  at: string,
  blocks: NativeChatMessage['blocks']
): NativeChatMessage {
  return { id, role, timestamp: Date.parse(at), source: 'transcript', blocks }
}

export const REVIEWER_AGENT_ID = 'a77d87fe2e3c0195d'
export const WINDOWS_REVIEWER_AGENT_ID = 'a8f65c53ecfad2908'

/** 22:44 the lead launched a background reviewer; 23:00 it ran a command;
 *  23:01 the safeguards ended its turn. The reviewer handed back at 23:03. */
export const API_ERROR_TURN: NativeChatMessage[] = [
  row('c1925af7-466c-46bb-9a0d-b853ffa0732a', 'assistant', '2026-09-23T22:44:04.576Z', [
    {
      type: 'tool-call',
      name: 'Agent',
      input: {
        description: 'Review mid-turn placement change',
        subagent_type: 'general-purpose',
        model: 'opus',
        prompt: 'Review an uncommitted diff in /Users/alwinpaul/Desktop/Project/Code UI'
      }
    }
  ]),
  row('d4c8ada3-3257-42ee-a206-ca10c2d5fb78', 'user', '2026-09-23T22:44:05.619Z', [
    { type: 'tool-result', output: agentLaunchResult(REVIEWER_AGENT_ID) }
  ]),
  row('56dd0077-4627-43d3-847e-058fb1d43d08', 'assistant', '2026-09-23T23:00:52.109Z', [
    { type: 'tool-call', name: 'Bash', input: { command: 'python3 - "$f"' } }
  ]),
  row('79caf281-f185-43ea-8ab8-1adc13914107', 'user', '2026-09-23T23:00:53.845Z', [
    { type: 'tool-result', output: "7371 assistant ['thinking']" }
  ]),
  row('0c508bf6-d5e7-4c5e-bfe9-d841e30f61ed', 'assistant', '2026-09-23T23:01:14.795Z', [
    { type: 'text', text: SAFEGUARDS_API_ERROR_TEXT }
  ])
]

/** Line 8335, 23:01:29.479Z: what the user sent next, and the turn it opened. */
export const CONTINUE_PROMPT = row('337932ca-7c5a-4818-9e0d-a1819dc4ad42', 'user', '2026-09-23T23:01:29.479Z', [
  { type: 'text', text: 'Continue' }
])

/** The start of line 8318's tool result: the command the lead ran last. */
export const BASH_OUTPUT = "7371 assistant ['thinking']"

/** What Orca's hook listener publishes once each turn has ended, both proved
 *  against the vendored listener in claude-lead-turn-ended.test.ts: the pane
 *  stays `working`, with no `monitoring` mode, for as long as the reviewer
 *  runs. After StopFailure the host holds no reply (Orca copies no text from
 *  it, and a Bash result has none it reads); after Stop it holds the reply
 *  the Stop hook named. */
export const API_ERROR_HOST_STATUS = {
  state: 'working' as const,
  lastAssistantMessage: undefined as string | undefined,
  lastAssistantMessageIsToolOutput: undefined as boolean | undefined,
  subagents: [{ id: REVIEWER_AGENT_ID, state: 'working' as const, startedAt: 0 }]
}
export const STOP_HOST_STATUS = {
  state: 'working' as const,
  lastAssistantMessage: STOP_REPLY_TEXT,
  lastAssistantMessageIsToolOutput: undefined as boolean | undefined,
  subagents: [{ id: WINDOWS_REVIEWER_AGENT_ID, state: 'working' as const, startedAt: 0 }]
}

/** 21:56:59 the lead launched a background reviewer and at 21:57:09 ended its
 *  turn normally. The reviewer ran until 22:13. */
export const STOP_TURN: NativeChatMessage[] = [
  row('af839d4a-2b48-4cbb-9df0-8c7665cc7a31', 'assistant', '2026-09-23T21:56:59.666Z', [
    {
      type: 'tool-call',
      name: 'Agent',
      input: {
        description: 'Review Windows host-control fixes',
        subagent_type: 'general-purpose',
        model: 'opus',
        prompt: 'Review an uncommitted diff in /Users/alwinpaul/Desktop/Project/Code UI'
      }
    }
  ]),
  row('072bbdca-2b25-4a53-9d46-db21e04d717e', 'user', '2026-09-23T21:57:00.715Z', [
    { type: 'tool-result', output: agentLaunchResult(WINDOWS_REVIEWER_AGENT_ID) }
  ]),
  row('2f0f203a-999d-4fbb-8fb2-fc3471ced4d5', 'assistant', '2026-09-23T21:57:09.137Z', [
    { type: 'text', text: STOP_REPLY_TEXT }
  ])
]
