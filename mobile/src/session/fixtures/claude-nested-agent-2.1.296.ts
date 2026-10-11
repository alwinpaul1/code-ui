import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { orcaTranscriptRows, recordsThrough, type RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// A subagent's own subagent, from the user's real session 0954729d (Claude Code
// 2.1.296), read-only off the desk on 2026-10-11. The lead's background agent
// "Reliable sends, never dropped" (a1fff1e8413ede9a2, spawnDepth 1) launched
// "Opus regression review of outbox drainer" (a26743ac8e4c1d699, spawnDepth 2,
// parentAgentId a1fff1e8413ede9a2 in its .meta.json) at 07:48:09, then went on
// working. At about 07:48:40 the Claude app's Background tasks sheet listed the
// reviewer as its own Running row ("Agent  30s") above "Reliable sends", while
// Code UI listed only "Reliable sends": the lead's transcript never launched
// the reviewer, so the count leaves it out (docs/mobile-background-tasks.md, "The
// count is the session's own work").
//
// claude-nested-agent-parent-2.1.296.json holds the parent's `user`/`assistant`
// records from 07:47:48 to 07:56:05 (verbatim but for thinking signatures and
// the fields the phone never receives), plus the queued_command attachment
// that carried the reviewer's `<task-notification>` at 07:55:15. The reviewer's
// hand-back reached the parent as an isMeta user record ("Another Claude
// session sent a message…"), which Orca's reader drops, so the parent's
// transcript, as the phone reads it, never says the reviewer ended.

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

export const NESTED_PARENT_AGENT = 'a1fff1e8413ede9a2'
export const NESTED_PARENT_TITLE = 'Reliable sends, never dropped'
export const NESTED_AGENT = 'a26743ac8e4c1d699'
export const NESTED_AGENT_TITLE = 'Opus regression review of outbox drainer'
export const NESTED_LAUNCHED_AT = Date.parse('2026-10-11T07:48:09.865Z')
/** The parent's first call after the launch result: the feed as the open sheet held it at 07:48:22. */
export const NESTED_AFTER_LAUNCH_UUID = '6badf53a'

type FixtureRecord = RawSubagentRecord | { type: 'attachment'; timestamp: string }

function records(): RawSubagentRecord[] {
  const all = JSON.parse(readFileSync(here('claude-nested-agent-parent-2.1.296.json'), 'utf8')) as FixtureRecord[]
  return all.filter((record): record is RawSubagentRecord => record.type === 'user' || record.type === 'assistant')
}

/** The parent's transcript as Orca's reader serves it, through the record with
 *  this uuid prefix (the whole stretch when absent). */
export function nestedParentRows(throughUuid?: string): NativeChatMessage[] {
  const all = records()
  return orcaTranscriptRows(throughUuid === undefined ? all : recordsThrough(all, throughUuid))
}
