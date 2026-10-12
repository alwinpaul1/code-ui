import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { orcaMobileWire } from './claude-read-results-2.1.283'
import { orcaTranscriptRows, type RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// Every record of the user's real sessions that names one background shell's
// id, read-only off the desk on 2026-10-12, in the order written; the calls
// whose results name it are kept too. Verbatim but for the thinking blocks and
// the fields the phone never receives (as claude-subagent-transcripts-2.1.296.ts).
//
// claude-shell-output-read-2.1.283.json, session 790eafa8 (Claude Code 2.1.283),
// shell bpzzmsk2t (the lint, typecheck and status gate):
//   15:14:16  launched in the background
//   15:15:56  the lead Reads its output file: 15 lines, no end trailer (running)
//   15:21:25  `tail -4 <its file>; cat <another task's file>`: the end trailer,
//             then another file's text, in one result
//
// claude-shell-taskoutput-2.1.275.json, session 5d877e39 (Claude Code 2.1.275),
// shell b4bdfgyp9 (a release build that waited on adb):
//   14:06:50  launched
//   14:08:48  `git log …; cat <its file>` and 14:08:53 `cat <its file> | head -5;
//             adb devices | tail -2`: the file mixed with other commands' output
//   15:01:33  TaskOutput: `<status>running</status>` and an `<output>` block
//   15:01:54  TaskStop
//   (two python probes in between name the id while reading other files)

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

const read = (name: string): RawSubagentRecord[] => JSON.parse(readFileSync(here(name), 'utf8')) as RawSubagentRecord[]

export const READ_SHELL = 'bpzzmsk2t'
export const TASK_OUTPUT_SHELL = 'b4bdfgyp9'

/** The rows as the phone receives them: Orca's reader, then its mobile wire. */
function asPhoneRows(records: readonly RawSubagentRecord[]): NativeChatMessage[] {
  return orcaTranscriptRows(records).map((row) => ({
    ...row,
    blocks: row.blocks.map((block) => (block.type === 'tool-result' ? { ...block, output: orcaMobileWire(block.output) } : block))
  }))
}

export const readShellRows = (): NativeChatMessage[] => asPhoneRows(read('claude-shell-output-read-2.1.283.json'))
export const taskOutputShellRows = (): NativeChatMessage[] => asPhoneRows(read('claude-shell-taskoutput-2.1.275.json'))
