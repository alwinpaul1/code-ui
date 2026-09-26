import type { AgentSubagentSnapshot } from '../../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { asyncAgentLaunchResult } from './claude-parallel-agents-2.1.281'

// ─── An orchestration session, as Claude Code 2.1.281 wrote it ───────────────
//
// Session 967668df, 2026-09-25 19:31 → 2026-09-26 00:34 UTC, entrypoint cli.
// Its records carry `"version":"2.1.281"` (the installed binary had moved on
// to 2.1.283; a running session keeps the build it started with). The lead ran
// five agents of its own for hours; each of those started reviewer agents of
// its own that came and went; background shells started and finished
// mid-turn. The phone read "Working… · N running tasks" as 5, 8, 5, 11, 10.
//
// Every id, timestamp and launch sentence below is the session's own: the
// Agent results use the verbatim text of `asyncAgentLaunchResult`, and the
// shell results were copied from the JSONL byte for byte. Descriptions and
// commands are placeholders; they were not read.
//
// Where each reviewer came from is in `subagents/agent-<id>.meta.json`
// (`spawnDepth: 2`, `parentAgentId` one of the lead's agents). The phone
// cannot read that file (`files.read` is jailed to the worktree); what it can
// see is that the LEAD's transcript never launched the reviewer.

/** The lead's own agents, with the call and result times of their launch. */
export const OWN_AGENTS = {
  a441: { id: 'a441049d174b06e5e', call: '2026-09-25T19:31:02.888Z', result: '2026-09-25T19:31:05.267Z' },
  a776: { id: 'a776c05112e5168b3', call: '2026-09-25T21:58:02.901Z', result: '2026-09-25T21:58:05.212Z' },
  acf3: { id: 'acf37785148986eb3', call: '2026-09-25T22:01:22.244Z', result: '2026-09-25T22:01:24.757Z' },
  adfd: { id: 'adfd480767cc35ec3', call: '2026-09-25T22:04:13.134Z', result: '2026-09-25T22:04:15.575Z' },
  abe6: { id: 'abe66e505fe909946', call: '2026-09-25T23:55:19.967Z', result: '2026-09-25T23:55:22.922Z' }
} as const

/** Reviewers the lead's agents started (spawnDepth 2), with the first record
 *  of each one's own transcript: the moment Orca's SubagentStart put it on the
 *  lead's roster. */
export const NESTED_REVIEWERS = {
  a874: { id: 'a874c9308661eb6ba', parent: 'adfd480767cc35ec3', first: '2026-09-25T23:19:10.661Z' },
  aba3: { id: 'aba3fed61e2c4fffc', parent: 'acf37785148986eb3', first: '2026-09-25T23:26:56.032Z' },
  a3a4: { id: 'a3a4e49c228d0370e', parent: 'a776c05112e5168b3', first: '2026-09-25T23:59:37.566Z' }
} as const

/** The pane's `stateStartedAt` from Orca's last-status.json: the lead asked
 *  a question at 23:23:06.940 (AskUserQuestion), the pane went `waiting`, and
 *  the answer a minute later started a NEW `working` state while four agents
 *  and a shell launched before it were still running. */
export const WORKING_AFTER_QUESTION = Date.parse('2026-09-25T23:24:06.944Z')

/** Orca's roster timestamps (`startedAt`, first observed). The four long
 *  agents read 23:07 although they launched hours earlier: Orca only saw
 *  them from then on. */
export const ROSTER_FIRST_OBSERVED: Record<string, number> = {
  acf37785148986eb3: 1790377624333,
  a776c05112e5168b3: 1790377630355,
  a441049d174b06e5e: 1790377639920,
  adfd480767cc35ec3: 1790377639920,
  abe66e505fe909946: 1790380522878
}

export function rosterRow(id: string, startedAt: number, description?: string): AgentSubagentSnapshot {
  return {
    id,
    state: 'working',
    startedAt,
    agentType: 'general-purpose',
    ...(description ? { description } : {})
  }
}

let nextId = 0
function message(role: NativeChatMessage['role'], at: string, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `orchestration-${nextId}`, role, timestamp: Date.parse(at), source: 'transcript', blocks: [block] }
}

/** The lead's Agent call and its launch result. */
export function ownAgentLaunch(agent: { id: string; call: string; result: string }): NativeChatMessage[] {
  return [
    message('assistant', agent.call, {
      type: 'tool-call',
      name: 'Agent',
      input: { description: `[description of ${agent.id}]`, prompt: '[prompt]', subagent_type: 'general-purpose', run_in_background: true }
    }),
    message('tool', agent.result, { type: 'tool-result', output: asyncAgentLaunchResult(agent.id) })
  ]
}

function outputPath(id: string): string {
  return `/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d/tasks/${id}.output`
}

/** `run_in_background: true`, as bbgtz4rfz (23:31:49) and bhll6so5h
 *  (23:14:48) were launched. */
export function backgroundShellLaunch(id: string, call: string, result: string): NativeChatMessage[] {
  return [
    message('assistant', call, {
      type: 'tool-call',
      name: 'Bash',
      input: { command: '[command]', description: `[description of ${id}]`, run_in_background: true }
    }),
    message('tool', result, {
      type: 'tool-result',
      output: `Command running in background with ID: ${id}. Output is being written to: ${outputPath(id)}. You will be notified when it completes. To check interim output, use Read on that file path.\nSession cwd remains /Users/alwinpaul/Desktop/Project/Code UI/mobile; directory changes made by the backgrounded command do not apply to subsequent commands.`
    })
  ]
}

/** A foreground command that ran past its timeout, as bhcfbe9vf did
 *  (called 23:24:54, moved to the background 23:26:57). */
export function movedToBackgroundLaunch(id: string, call: string, result: string): NativeChatMessage[] {
  return [
    message('assistant', call, { type: 'tool-call', name: 'Bash', input: { command: '[command]', description: `[description of ${id}]` } }),
    message('tool', result, {
      type: 'tool-result',
      output: `Command did not complete within its 120s timeout and was moved to the background (ID: ${id}). Output is being written to: ${outputPath(id)}. You will be notified when it completes. To check interim output, use Read on that file path.`
    })
  ]
}

/** The lead stopping a shell, as it stopped bhcfbe9vf at 00:20:27. No
 *  notification follows a stop: the call and its result are all there is. */
export function taskStop(id: string, call: string, result: string): NativeChatMessage[] {
  return [
    message('assistant', call, { type: 'tool-call', name: 'TaskStop', input: { task_id: id } }),
    message('tool', result, {
      type: 'tool-result',
      output: JSON.stringify({ message: `Successfully stopped task: ${id} ([command])`, task_id: id, task_type: 'local_bash', command: '[command]' })
    })
  ]
}

/** The lead messaging one of its agents, which resumes a finished one. */
export function sendMessage(to: string, at: string): NativeChatMessage[] {
  return [
    message('assistant', at, {
      type: 'tool-call',
      name: 'SendMessage',
      input: { to, recipient: to, type: 'message', message: '[message]', summary: '[summary]', content: '[message]' }
    })
  ]
}

/** Any other turn of the lead's, which pushes launches up the window. */
export function leadTurn(at: string): NativeChatMessage {
  return message('assistant', at, { type: 'text', text: '[reply]' })
}
