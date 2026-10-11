// "Show output" for a background shell (parity gap G27).
//
// The Claude app asks Claude Code for a task's output (`get_task_output`).
// Orca offers nothing like it, and its file reads never reach the file Claude
// Code writes the output to (`<session tmp>/tasks/<id>.output`): a worktree
// read cannot leave the worktree, and a read grant outside it is minted only
// for a path the terminal printed (`hasRecentTerminalOutputPath`) or one an
// ASSISTANT text block names (`nativeChatTranscriptIncludesPath`, Orca
// src/main/native-chat/native-chat-file-provenance.ts). The output path is
// named only in the launch's tool result and the `<task-notification>`, a user
// row, and Claude Code's TUI does not print it.
//
// What the phone does hold is every time the agent read that file itself, and
// those results are the file's text at the time:
//
// - TaskOutput `{task_id}`: `<status>` and an `<output>` block (real record,
//   Claude Code 2.1.275: fixtures/claude-shell-taskoutput-2.1.275.json);
// - a Read of exactly that file: its numbered lines (2.1.283);
// - a Bash command that is nothing but `cat` of that file (whole) or `tail` /
//   `head` of it (a part). A command that also runs anything else is not
//   read: its result holds the other commands' output too, and there is no
//   telling where the file's text ends (every read of the 7h gate in session
//   0954729d was such a command).
//
// The latest such read is shown. A transcript result is paired with its call
// first in, first out, so a read is trusted only when it was the one read in
// flight (as `soleOutputRead`).

import { isToolCallBlock, isToolResultBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  OUTPUT_TRAILER,
  TASK_OUTPUT_FILE,
  isFailedAnswer,
  readString,
  takeAnsweredCall,
  type PendingCall
} from './mobile-background-task-transcript'
import { ORCA_WIRE_CUT_MARK, readViewOf, readViewText } from './mobile-native-chat-read-view'

export type ShellOutputCapture =
  | {
      kind: 'captured'
      text: string
      /** Only part of the file: a tail or head, a ranged Read, or Orca's wire cut. */
      truncated: boolean
      /** The shell was still running when this was read, as far as the read shows. */
      whileRunning: boolean
      via: 'TaskOutput' | 'Read' | 'Bash'
    }
  | { kind: 'none' }

const READING_TOOLS = new Set(['Bash', 'Read', 'TaskOutput'])
const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/
const QUIET = String.raw`(?:\s+2>\s*/dev/null)?`
const TASK_ID_TAG = /<task_id>\s*([^<]+?)\s*<\/task_id>/
const STATUS_TAG = /<status>\s*([^<]+?)\s*<\/status>/
const OUTPUT_OPEN = '<output>'
const OUTPUT_CLOSE = '</output>'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** The one task output file a text names, or null for none or several. */
function soleOutputFile(text: string): { id: string; path: string } | null {
  const found = [...text.matchAll(TASK_OUTPUT_FILE)]
  const ids = new Set(found.map((match) => match[1]!))
  if (ids.size !== 1) {
    return null
  }
  const match = found[0]!
  // The whole path: back from the match to the start of the word it sits in.
  const start = Math.max(text.lastIndexOf(' ', match.index), text.lastIndexOf('"', match.index), text.lastIndexOf("'", match.index)) + 1
  return { id: match[1]!, path: text.slice(start, match.index + match[0].length) }
}

function stripWireCut(output: string): { text: string; cut: boolean } {
  return output.endsWith(ORCA_WIRE_CUT_MARK)
    ? { text: output.slice(0, -ORCA_WIRE_CUT_MARK.length), cut: true }
    : { text: output, cut: false }
}

function endsWithTrailer(text: string): boolean {
  const last = text.trimEnd().split('\n').at(-1) ?? ''
  return OUTPUT_TRAILER.test(last)
}

/** How a Bash command reads the file: whole, a part, or not only the file. */
function bashReadShape(command: string, path: string): 'whole' | 'part' | null {
  const bare = command.replace(LEADING_CD, '').trim()
  const file = String.raw`(["']?)${escapeRegExp(path)}\1`
  if (new RegExp(String.raw`^cat\s+${file}${QUIET}$`).test(bare)) {
    return 'whole'
  }
  if (new RegExp(String.raw`^(?:tail|head)(?:\s+-n\s*\d+|\s+-\d+|\s+-c\s*\d+)?\s+${file}${QUIET}$`).test(bare)) {
    return 'part'
  }
  return null
}

function fromTaskOutput(taskId: string, output: string): ShellOutputCapture | null {
  if (TASK_ID_TAG.exec(output)?.[1] !== taskId) {
    return null
  }
  const open = output.indexOf(OUTPUT_OPEN)
  if (open === -1) {
    return null
  }
  const { text: rest, cut } = stripWireCut(output.slice(open + OUTPUT_OPEN.length))
  const close = rest.lastIndexOf(OUTPUT_CLOSE)
  const body = (close === -1 ? rest : rest.slice(0, close)).replace(/^\n/, '').replace(/\n$/, '')
  return {
    kind: 'captured',
    text: body,
    truncated: cut || close === -1,
    whileRunning: STATUS_TAG.exec(output)?.[1] === 'running',
    via: 'TaskOutput'
  }
}

function judge(call: PendingCall, output: string, taskId: string): ShellOutputCapture | null {
  if (call.name === 'TaskOutput') {
    return readString(call.input, 'task_id') === taskId ? fromTaskOutput(taskId, output) : null
  }
  if (call.name === 'Read') {
    const path = readString(call.input, 'file_path') ?? ''
    const named = soleOutputFile(path)
    if (named?.id !== taskId || named.path !== path) {
      return null
    }
    const view = readViewOf(call, output)
    if (!view) {
      return null
    }
    const text = readViewText(view.lines)
    return { kind: 'captured', text, truncated: view.truncated, whileRunning: !view.truncated && !endsWithTrailer(text), via: 'Read' }
  }
  const command = readString(call.input, 'command') ?? ''
  const named = soleOutputFile(command)
  if (named?.id !== taskId) {
    return null
  }
  const shape = bashReadShape(command, named.path)
  if (!shape) {
    return null
  }
  const { text, cut } = stripWireCut(output)
  const truncated = cut || shape === 'part'
  // A tail still shows the end trailer when there is one.
  return { kind: 'captured', text, truncated, whileRunning: !cut && !endsWithTrailer(text), via: 'Bash' }
}

/** The latest read of this shell's output the transcript holds. */
export function capturedShellOutput(messages: readonly NativeChatMessage[], taskId: string): ShellOutputCapture {
  const pending: PendingCall[] = []
  let latest: ShellOutputCapture = { kind: 'none' }
  for (const message of messages) {
    for (const block of message.blocks) {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name, input: block.input, startedAt: null, ...(block.callId ? { callId: block.callId } : {}) })
        continue
      }
      if (!isToolResultBlock(block)) {
        continue
      }
      const readsInFlight = pending.filter((call) => READING_TOOLS.has(call.name)).length
      const call = takeAnsweredCall(pending, block)
      if (!call || !READING_TOOLS.has(call.name) || isFailedAnswer(block)) {
        continue
      }
      if (block.callId === undefined && readsInFlight !== 1) {
        continue
      }
      const found = judge(call, block.output, taskId)
      if (found) {
        latest = found
      }
    }
  }
  return latest
}
