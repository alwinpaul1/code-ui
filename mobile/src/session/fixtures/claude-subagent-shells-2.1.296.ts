import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AgentSubagentSnapshot } from '../../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// A throwaway Claude Code 2.1.296 session, driven in tmux on 2026-10-10 in a
// scratch directory (session 8a91e289), to see what the lead can know about
// shells its background subagents start. docs/subagent-task-visibility.md has
// the whole probe; this file keeps what the tests replay:
//
// - the lead's own transcript records, verbatim (the Agent calls and their
//   launch results), which is all the phone's transcript reader is handed;
// - two `tmux capture-pane -p` screens, byte for byte, in the .txt files
//   beside this one.
//
// Scenario 1 (16:23:42Z): the lead launched agents "Sleep probe A" and "Sleep
// probe B" in the background; each ran `sleep 150` with run_in_background and
// then a foreground `sleep 20`. The lead launched no shell of its own. The
// footer read "· 2 shells" while both agents ran.
//
// Scenario D (16:28:36Z): the lead's own `sleep 100` had already reported; it
// launched agent "Probe D", which ran `sleep 120` in the background and then a
// foreground ping. The footer read "· 1 shell" while D ran.

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

/** The screen's rows, as `tmux capture-pane -p` printed them (110 columns). */
export const screenRows = (name: string): string[] => readFileSync(here(name), 'utf8').split('\n')

export const TWO_SUBAGENT_SHELLS_SCREEN = 'claude-screen-two-subagent-shells-2.1.296.txt'
export const SUBAGENT_SHELL_SCREEN = 'claude-screen-subagent-shell-after-lead-shell-2.1.296.txt'

export const PROBE_A = 'a77334b4f00353b46'
export const PROBE_B = 'af27294753f55525d'
export const PROBE_D = 'a4473a7e9aa3def95'

const SCRATCH =
  '/private/tmp/claude-501/-private-tmp-claude-501--Users-alwinpaul-Desktop-Project-Code-UI-0954729d-6205-4368-8185-7c630268f2d0-scratchpad-probe-work/8a91e289-af95-45fa-a320-13316e2dc64c'

const launchResult = (id: string) =>
  `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: ${id} (internal ID - do not mention to user. Use SendMessage with to: '${id}', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: ${SCRATCH}/tasks/${id}.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`

let nextId = 0
function record(role: NativeChatMessage['role'], at: string, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `probe-${nextId}`, role, timestamp: Date.parse(at), source: 'transcript', blocks: [block] }
}

const agentCall = (at: string, description: string, prompt: string) =>
  record('assistant', at, { type: 'tool-call', name: 'Agent', input: { description, prompt, run_in_background: 'true' } })
const toolResult = (at: string, output: string) => record('user', at, { type: 'tool-result', output })

/** Scenario 1's lead window. The results came back B first, as Claude wrote them. */
export const twoAgentLaunches = (): NativeChatMessage[] => [
  agentCall(
    '2026-10-10T16:23:42.042Z',
    'Sleep probe A',
    'Run the Bash command "sleep 150" with run_in_background true, then run Bash "sleep 20" in the foreground, then reply "done" and stop.'
  ),
  agentCall(
    '2026-10-10T16:23:42.758Z',
    'Sleep probe B',
    'Run the Bash command "sleep 150" with run_in_background true, then run Bash "sleep 20" in the foreground, then reply "done" and stop.'
  ),
  toolResult('2026-10-10T16:23:43.370Z', launchResult(PROBE_B)),
  toolResult('2026-10-10T16:23:43.391Z', launchResult(PROBE_A))
]

/** Scenario D's lead window: only the launch of Probe D. */
export const probeDLaunch = (): NativeChatMessage[] => [
  agentCall(
    '2026-10-10T16:28:36.713Z',
    'Probe D',
    'First run Bash "sleep 120" with run_in_background true. Then run, in the foreground (not background), the Bash command "ping -c 45 127.0.0.1" and wait for it to finish. Then reply "done".'
  ),
  toolResult('2026-10-10T16:28:37.093Z', launchResult(PROBE_D))
]

/** Orca's roster row for a running agent, as SubagentStart puts it there:
 *  id, type and a first-observed time, and no tool, step or command (the
 *  vendored AgentSubagentSnapshot has no field for one). */
export const workingRow = (id: string, startedAt: string): AgentSubagentSnapshot => ({
  id,
  agentType: 'general-purpose',
  state: 'working',
  startedAt: Date.parse(startedAt)
})
