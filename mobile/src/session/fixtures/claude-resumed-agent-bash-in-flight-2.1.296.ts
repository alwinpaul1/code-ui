import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { orcaTranscriptRows, type RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// A background agent the lead resumed with SendMessage, then caught mid-Bash, from the user's real
// session 0954729d (Claude Code 2.1.296), read-only off the desk on 2026-10-11.
//
// The lead launched "Show chat images like Claude" (af91594a71c8c11d0) at 14:30:46, the agent
// handed back at 15:31:08 (written only as records Orca's reader drops), and the lead resumed it at
// 15:31:20 with SendMessage ("Resuming agent af91594", `resumedAgentId`). At 15:36:06 the agent
// started its full gate in one Bash call, `cd "/Users/alwinpaul/Desktop/Project/Code
// UI/.claude/worktrees/agent-af91594a71c8c11d0/mobile" && node scripts/build-terminal-… && pnpm test
// …`, answered at 15:40:55. For those five minutes Code UI's Background tasks sheet titled the row
// "Running cd "/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/ag…", where the Claude
// app showed "Show chat images like Claude" (the user's screenshot, 2026-10-11).
//
// claude-resumed-agent-bash-in-flight-2.1.296.json holds, verbatim but for the Agent call's
// `prompt` and SendMessage's `message`/`content` (elided) and the `caller` fields the phone never
// receives:
// - `lead`: the Agent call (record 13721 of the lead's JSONL), its launch result (13724), the
//   SendMessage call (14196) and its "Resuming agent" result (14198);
// - `subagent`: the resume prompt (record 999 of the agent's JSONL, an isMeta string that Orca's
//   reader drops; text elided), the gate's Bash call (1205) and its answer (1207). The 205 records
//   between them are left out: the row's title depends only on which call is unanswered.

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

type Fixture = { lead: RawSubagentRecord[]; subagent: RawSubagentRecord[] }

const read = (): Fixture =>
  JSON.parse(readFileSync(here('claude-resumed-agent-bash-in-flight-2.1.296.json'), 'utf8')) as Fixture

export const RESUMED_AGENT = 'af91594a71c8c11d0'
export const RESUMED_AGENT_TITLE = 'Show chat images like Claude'
/** The SendMessage result that says the run started again. */
export const RESUMED_AT = Date.parse('2026-10-11T15:31:21.493Z')
/** The gate's Bash call went out, and was answered. */
export const GATE_CALLED_AT = Date.parse('2026-10-11T15:36:06.103Z')
export const GATE_ANSWERED_AT = Date.parse('2026-10-11T15:40:55.966Z')

/** The lead's transcript as Orca's reader serves it: the launch and the resume. */
export function resumedLeadRows(): NativeChatMessage[] {
  return orcaTranscriptRows(read().lead)
}

/** The agent's own transcript as the open sheet reads it: with the gate in flight, or answered. */
export function resumedAgentRows({ answered }: { answered: boolean }): NativeChatMessage[] {
  const records = read().subagent
  return orcaTranscriptRows(answered ? records : records.slice(0, -1))
}
