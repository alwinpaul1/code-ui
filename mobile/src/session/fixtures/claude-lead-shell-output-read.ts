import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { orcaTranscriptRows, type RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// The lead's own records from the user's real session 0954729d (a hand-started
// `claude -r codeui`, so no launch flag, no beacon), read-only off the desk on
// 2026-10-11. Kept: every `user`/`assistant` record of the stretch, verbatim
// but for thinking signatures and the fields the phone never receives; the
// `queue-operation` records and the `queued_command` attachment are kept too,
// for the record, and `leadRows` drops them the way Orca's reader does.
//
// claude-lead-shell-output-read-2.1.296.json (Claude Code 2.1.296), the
// stale "cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile" && exp…" row the
// sheet showed running for 7h 18m:
//
//   00:30:05  the lead starts the full gate in the background (b1ycnvrjn)
//   00:30:45  a foreground `until grep … b1ycnvrjn.output …; cat …` waits on
//             its output; its result (00:34:26) is the file while the gate
//             still ran: no end trailer
//   00:34:45  the gate ends. Its `<task-notification>` is a queue-operation
//             enqueue, delivered mid-turn as a queued_command attachment:
//             neither reaches the phone
//   00:34:47  the lead runs `cat …/tasks/b1ycnvrjn.output | tail -2; …`, and
//             the result opens with the file's last line, "[exited with code 0]"
//
// Claude Code ends every background task's output file with that trailer, or
// "[killed]" for a stopped one. On the desk, 2026-10-11: 199 output files in
// this session's tasks directory, 171 ending "[exited with code N]", 24
// "[killed]", and the 4 shells still running at the time (two `until grep`
// waits and an `adb logcat` that subagents' timed-out commands left behind)
// with neither.
//
// claude-two-file-output-read-2.1.295.json (Claude Code 2.1.295): one Bash
// call that `cat`s bd8cz0m8s's output (finished, trailer included) and then
// `tail -2`s bxunvpnvx's, which was still running (a TaskStop killed it 30 s
// later). The trailer in that result is bd8cz0m8s's, so a read naming two
// output files proves nothing about either.

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))

type FixtureRecord = RawSubagentRecord | { type: 'queue-operation' | 'attachment'; timestamp: string }

const read = (name: string): FixtureRecord[] => JSON.parse(readFileSync(here(name), 'utf8')) as FixtureRecord[]

export const GATE_SHELL = 'b1ycnvrjn'
export const GATE_LAUNCHED_AT = Date.parse('2026-10-11T00:30:05.376Z')
/** The record whose result carries the trailer: the read that proves the end. */
export const GATE_TRAILER_READ_UUID = '5837a9c9'
/** The foreground wait's result: the output file while the gate still ran. */
export const GATE_RUNNING_READ_UUID = '06e1c086'
export const TWO_FILE_RUNNING_SHELL = 'bxunvpnvx'
export const TWO_FILE_FINISHED_SHELL = 'bd8cz0m8s'

function isTranscriptRecord(record: FixtureRecord): record is RawSubagentRecord {
  return record.type === 'user' || record.type === 'assistant'
}

/** The lead's rows as Orca's transcript reader serves them, through the record
 *  with this uuid prefix (the whole stretch when absent). */
export function leadRows(file: 'gate' | 'two-file', throughUuid?: string): NativeChatMessage[] {
  const records = read(file === 'gate' ? 'claude-lead-shell-output-read-2.1.296.json' : 'claude-two-file-output-read-2.1.295.json').filter(
    isTranscriptRecord
  )
  const end = throughUuid === undefined ? records.length - 1 : records.findIndex((record) => record.uuid.startsWith(throughUuid))
  if (end === -1) {
    throw new Error(`no record ${throughUuid}`)
  }
  return orcaTranscriptRows(records.slice(0, end + 1))
}

/** The raw records that never reach the phone, for the test that says so. */
export function gateQueueRecords(): FixtureRecord[] {
  return read('claude-lead-shell-output-read-2.1.296.json').filter((record) => !isTranscriptRecord(record))
}
