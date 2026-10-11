import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatBlock, NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { orcaTranscriptRows, recordsThrough, type RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// Two rows still running, recorded in the lead's own transcript (session
// 0954729d, Claude Code 2.1.296, 2026-10-11, records 15:51:00 to 16:01:17),
// trimmed only of thinking and of the Agent prompt past its first 200
// characters. The user screen-recorded the same moment in the Claude app and in
// Code UI at 15:57:41:
//
// - A background Agent call, "Fix status line usage figures": launched at
//   15:51:10 (its launch result answered at once), and finished at 16:00:45,
//   which the transcript records only as a queue-operation Orca drops. The
//   Claude app drew "Running agent: Fix status line usage figures ›" with its
//   shimmer; Code UI "Ran 1 agent ›".
// - A foreground Bash call, "Run the full gate on main" (timeout 600000),
//   made at 15:51:16 and unanswered for ten minutes, until Claude Code moved it
//   to the background at 16:01:17 (ID b3w804om8). The Claude app drew a
//   terminal glyph and "Running ›" with the shimmer; Code UI
//   "Ran Run the full gate on main ›".

export const RUNNING_ROWS_AGENT_ID = 'af711658830de8346'
export const RUNNING_ROWS_AGENT_DESCRIPTION = 'Fix status line usage figures'
export const RUNNING_ROWS_SHELL_ID = 'b3w804om8'
export const RUNNING_ROWS_SHELL_DESCRIPTION = 'Run the full gate on main'

/** The record whose write the recording falls after: the Bash call. */
export const BASH_CALL_UUID = '92c8020b'
/** Claude Code's answer moving the Bash call to the background. */
export const BASH_MOVED_UUID = '5411e70f'

const records = (): RawSubagentRecord[] =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./claude-running-rows-2.1.296.json', import.meta.url)), 'utf8')
  ) as RawSubagentRecord[]

/** The transcript as Orca served it through the record with this uuid. */
export function runningRowsMessages(throughUuid: string): NativeChatMessage[] {
  return orcaTranscriptRows(recordsThrough(records(), throughUuid))
}

function toolBlocks(messages: readonly NativeChatMessage[], name: string): NativeChatBlock[] {
  const blocks = messages.flatMap((message) => message.blocks).filter((block) => block.type !== 'text')
  const start = blocks.findIndex((block) => block.type === 'tool-call' && block.name === name)
  return start === -1 ? [] : blocks.slice(start, start + 2).filter((block, index) => index === 0 || block.type === 'tool-result')
}

/** The Agent call's run: the call and its launch result. */
export function agentRun(): NativeChatBlock[] {
  return toolBlocks(runningRowsMessages(BASH_CALL_UUID), 'Agent')
}

/** The Bash call's run as the transcript held it at the recording: the call alone. */
export function bashRunUnanswered(): NativeChatBlock[] {
  return toolBlocks(runningRowsMessages(BASH_CALL_UUID), 'Bash')
}

/** The Bash call's run once it was moved to the background. */
export function bashRunMovedToBackground(): NativeChatBlock[] {
  return toolBlocks(runningRowsMessages(BASH_MOVED_UUID), 'Bash')
}
