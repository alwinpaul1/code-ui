import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatBlock, NativeChatMessage } from '../../../../src/shared/native-chat-types'

// Two subagents' own transcripts, from a throwaway Claude Code 2.1.296 session
// driven in tmux (`tmux -L cuisub`) on 2026-10-10 in a scratch directory
// (session 59454ec6). The lead launched "Sleep probe A" and "Sleep probe B" as
// background agents:
//
//   A: `sleep 120` with run_in_background (bp1iyjcpa), then the foreground
//      `cd /private/tmp && ls | head -3`, then a foreground `sleep 25` the
//      harness refused, then its hand-back. Its shell outlived it: the
//      notification came at 18:47:16, to A, not to the lead.
//   B: `sleep 30` with run_in_background (bbg412m8r), a refused foreground
//      `sleep 45`, a ToolSearch, an `ls -la` of the shell's output file, a
//      second background `sleep 200` (bnj50z9e4) stopped at once with
//      TaskStop, then its hand-back. bbg412m8r's notification reached B at
//      18:45:46, after the hand-back.
//
// The .json files beside this one are the `user`/`assistant` records of
// `<session>/subagents/agent-<id>.jsonl`, verbatim but for what the phone
// never receives: the `attachment` records (hook output, the environment),
// the thinking blocks' signatures, and every field but type, uuid,
// timestamp, isMeta and message.content.
//
// `orcaTranscriptRows` maps them the way Orca 1.4.224's transcript reader does
// (its bundle, `/Applications/Orca.app/Contents/Resources/app.asar`, read
// 2026-10-10): only `user` and `assistant` records; a `user` record with
// `isMeta: true` keeps ONLY its tool results (unless it is all image markers),
// so a subagent's `<task-notification>` — an isMeta record in 2.1.296 — never
// reaches the phone; a user record of tool results alone is role `tool`; a
// call keeps its `tool_use` id as `callId` and its result does not.

type RawBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking' }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }

export type RawSubagentRecord = {
  type: 'user' | 'assistant'
  uuid: string
  timestamp: string
  isMeta?: boolean
  content: string | RawBlock[]
}

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

const read = (name: string): RawSubagentRecord[] => JSON.parse(readFileSync(here(name), 'utf8')) as RawSubagentRecord[]

export const PROBE_A_AGENT = 'a7ecda0b501ecd6b7'
export const PROBE_B_AGENT = 'aa263289bd7f1b654'
export const PROBE_A_SHELL = 'bp1iyjcpa'
export const PROBE_B_SHELL = 'bbg412m8r'
export const PROBE_B_STOPPED_SHELL = 'bnj50z9e4'

export const probeARecords = (): RawSubagentRecord[] => read('claude-subagent-transcript-probe-a-2.1.296.json')
export const probeBRecords = (): RawSubagentRecord[] => read('claude-subagent-transcript-probe-b-2.1.296.json')

/** The records up to and including the one with this uuid: the transcript as
 *  the host would have served it at that moment of the real run. */
export function recordsThrough(records: readonly RawSubagentRecord[], uuidPrefix: string): RawSubagentRecord[] {
  const end = records.findIndex((record) => record.uuid.startsWith(uuidPrefix))
  if (end === -1) {
    throw new Error(`no record ${uuidPrefix}`)
  }
  return records.slice(0, end + 1)
}

function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string' ? item.text : ''))
      .join('')
  }
  return ''
}

function blocksOf(record: RawSubagentRecord): NativeChatBlock[] {
  if (typeof record.content === 'string') {
    return record.content.trim() ? [{ type: 'text', text: record.content }] : []
  }
  const blocks: NativeChatBlock[] = []
  for (const block of record.content) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      blocks.push({ type: 'tool-call', name: block.name, input: block.input, callId: block.id } as NativeChatBlock)
    } else if (block.type === 'tool_result') {
      blocks.push({ type: 'tool-result', output: resultText(block.content), ...(block.is_error ? { isError: true } : {}) } as NativeChatBlock)
    }
  }
  return blocks
}

export function orcaTranscriptRows(records: readonly RawSubagentRecord[]): NativeChatMessage[] {
  const rows: NativeChatMessage[] = []
  for (const record of records) {
    const all = blocksOf(record)
    const blocks = record.type === 'user' && record.isMeta === true ? all.filter((block) => block.type === 'tool-result') : all
    if (blocks.length === 0) {
      continue
    }
    const role = record.type === 'user' && blocks.every((block) => block.type === 'tool-result') ? 'tool' : record.type
    rows.push({ id: record.uuid, role, timestamp: Date.parse(record.timestamp), source: 'transcript', blocks })
  }
  return rows
}
