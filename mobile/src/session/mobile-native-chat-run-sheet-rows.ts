import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { createToolInputDisplay } from '../../../src/shared/native-chat-tool-summary'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { createCodexPollFolder } from './codex-stdin-poll'
import { soleCallCreatedFile } from './mobile-native-chat-edited-files'
import { isAgentToolName, type NativeChatAgentRunEntry } from './mobile-native-chat-agent-run'
import { agentTitle, readString } from './mobile-background-task-transcript'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'
import { toolDetailInputRows, toolDetailStatus } from './mobile-native-chat-tool-detail'
import { sendMessageDetail, toolCallKind } from './mobile-native-chat-tool-sentence'
import type { ToolRunKind } from './mobile-native-chat-tool-kind'
import { cutWholeCharacters } from '../text/whole-character-cut'
import { toolCallPath } from './tool-call-path-keys'

// ─── The rows of a run's sheet ──────────────────────────────────────────────
//
// The sheet behind a run's row lists every call as icon + verb + description,
// the way the Claude app's does (the user's screenshots of 2026-10-01, Claude
// Code with a CronDelete, three Bash commands and an Agent):
//   Used CronDelete  id                          the input key, muted
//   Ran  <the Bash call's description>
//   Ran agent  <the agent's description>
// Every verb is past tense, the running agent's row included: the screenshot
// shows "Ran agent" under a "Running agent" row. The verbs for the kinds the
// screenshot did not show (read, edit, search, web, skill, message) are this
// client's own, taken from the run sentence's words (mobile-native-chat-tool-
// sentence.ts) and not checked against the app.

export type RunSheetRow = {
  /** What the call did to the reader; the sheet picks its icon by it. */
  kind: ToolRunKind
  /** The verb or tool phrase, always past tense: "Ran", "Read", "Used Foo". */
  verb: string
  /** What it ran on, or null where the call names nothing. */
  detail: string | null
  /** The detail is an input KEY, not a value: drawn muted. Set only for a
   *  tool the phone has no verb for ("Used CronDelete  id"). */
  detailIsKey: boolean
  /** The call failed, by its result or its own state. */
  failed: boolean
  /** The call and its result, for the detail sheet a tap opens. */
  pair: NativeChatToolPair
  /** A tap on the row opens something. False for an Agent/Task row whose agent
   *  id the phone does not know: its generic detail sheet would show the launch
   *  result's own text ("internal metadata, never quote"), so the row stays
   *  inert, as the agent-only sheet's rows were. */
  opens: boolean
  /** The agent this call launched, where the phone knows which one; a row
   *  with one opens that agent's transcript. */
  agentId: string | null
}

/** Longest result line a call-less row quotes. */
const RESULT_PREVIEW_CHARS = 80

function fileName(path: string | null): string | null {
  const name = path?.split(/[/\\]/).pop()?.trim()
  return name ? name : null
}

/** The label the generic input display gives a call (its path, query, command
 *  or URL), or null when it has none. */
function inputLabel(input: unknown): string | null {
  const label = createToolInputDisplay(input).label.trim()
  return label.length > 0 ? label : null
}

/** The first input key of a call with named inputs: the only thing a tool the
 *  phone has no verb for says about itself that is not a value. Null for a
 *  call with no input, or one whose input is a bare string or number. */
function firstInputKey(input: unknown): string | null {
  const structured =
    (typeof input === 'object' && input !== null) ||
    (typeof input === 'string' && /^\s*[{[]/.test(input))
  return structured ? (toolDetailInputRows(input)[0]?.name ?? null) : null
}

function editDetail(pair: NativeChatToolPair): { verb: string; detail: string | null } {
  const call = pair.call!
  const files = editFilesForToolCall(call, pair.result ?? null)
  const paths = files && files.length > 0 ? files.map((file) => file.path) : []
  const own = toolCallPath(call.input)
  const verb = soleCallCreatedFile({ call, result: pair.result ?? null }) ? 'Created' : 'Edited'
  if (paths.length > 1) {
    return { verb, detail: `${paths.length} files` }
  }
  return { verb, detail: fileName(paths[0] ?? own) ?? inputLabel(call.input) }
}

function rowOf(pair: NativeChatToolPair): Omit<RunSheetRow, 'pair' | 'failed' | 'agentId' | 'opens'> {
  const call = pair.call
  if (!call) {
    // A result whose call the window cut: its first line is all there is.
    const line = pair.result?.output.split('\n').find((text) => text.trim().length > 0) ?? ''
    return {
      kind: 'other',
      verb: 'Result',
      detail: line ? cutWholeCharacters(line.trim(), RESULT_PREVIEW_CHARS) : null,
      detailIsKey: false
    }
  }
  const kind = toolCallKind(call.name)
  const plain = (verb: string, detail: string | null) => ({ kind, verb, detail, detailIsKey: false })
  switch (kind) {
    case 'command': {
      const description = readString(call.input, 'description')
      return plain('Ran', description ? description.replace(/\s+/g, ' ').trim() : inputLabel(call.input))
    }
    case 'agent':
      return plain('Ran agent', agentTitle(call.input))
    case 'read':
      return plain('Read', fileName(toolCallPath(call.input)) ?? inputLabel(call.input))
    case 'edit':
      return { kind, detailIsKey: false, ...editDetail(pair) }
    case 'search':
      return plain('Searched', inputLabel(call.input))
    case 'web':
      return plain('Fetched', inputLabel(call.input))
    case 'webSearch':
      return plain('Searched the web', inputLabel(call.input))
    case 'skill':
      return plain('Ran skill', readString(call.input, 'skill') ?? readString(call.input, 'name') ?? inputLabel(call.input))
    case 'message': {
      const message = sendMessageDetail(call)
      return plain('Messaged', message ? [message.to, message.preview].filter(Boolean).join(' ') : null)
    }
    case 'other': {
      const key = firstInputKey(call.input)
      return { kind, verb: `Used ${call.name.trim() || 'a tool'}`, detail: key, detailIsKey: key !== null }
    }
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

/** One row per call of the run, in run order, every call and no cap. A Codex
 *  poll of a command the run already counts gives no row, as the run's
 *  sentence counts none (codex-stdin-poll.ts). `agentEntries` are the run's
 *  agents in call order (`agentRunState(blocks, …).entries`):
 *  the nth Agent/Task row takes the nth entry's id. */
export function runSheetRows(
  blocks: readonly NativeChatBlock[],
  agentEntries: readonly NativeChatAgentRunEntry[]
): RunSheetRow[] {
  const rows: RunSheetRow[] = []
  const foldsIntoCommand = createCodexPollFolder()
  let agentIndex = 0
  for (const pair of pairToolBlocks(blocks)) {
    if (pair.call && foldsIntoCommand(pair.call.name, pair.call.input)) {
      const command = rows.at(-1)
      if (command) {
        rows[rows.length - 1] = withPoll(command, pair)
      }
      continue
    }
    const isAgentCall = pair.call !== undefined && isAgentToolName(pair.call.name)
    const agentId = isAgentCall ? (agentEntries[agentIndex++]?.agentId ?? null) : null
    rows.push({
      ...rowOf(pair),
      failed: toolDetailStatus(pair) === 'Failed',
      pair,
      agentId,
      opens: !isAgentCall || agentId !== null
    })
  }
  return rows
}

/** A poll folded into the command it drives: the command's row keeps its own
 *  call and its detail sheet then shows the start's output and each poll's, in
 *  order, as one result that is an error when any of them was. Folded away
 *  whole, a failed poll left a row that said the command went fine. */
function withPoll(row: RunSheetRow, poll: NativeChatToolPair): RunSheetRow {
  const pollFailed = toolDetailStatus(poll) === 'Failed'
  const outputs = [row.pair.result?.output, poll.result?.output].filter(
    (text): text is string => text !== undefined && text.length > 0
  )
  const isError = row.pair.result?.isError === true || poll.result?.isError === true
  const result =
    row.pair.result || poll.result
      ? { ...(row.pair.result ?? poll.result!), output: outputs.join('\n\n'), isError }
      : undefined
  return {
    ...row,
    failed: row.failed || pollFailed,
    pair: { ...row.pair, ...(result ? { result } : {}) }
  }
}
