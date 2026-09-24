import { isEditToolName, editFilesFromToolPair } from '../../../src/shared/native-chat-edit-normalize'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

/** "Completed" / "Failed" / "Running" for ONE call, the way the Claude app's
 *  sheet states it under the title. A result settles the call regardless of
 *  what lifecycle state the call itself carried; absent one, the call's own
 *  `state` speaks, and absent that too the call is taken as still running —
 *  the same default the live-activity selector uses for a legacy transcript
 *  that never wrote a `state` at all. */
export type ToolDetailStatus = 'Completed' | 'Failed' | 'Running'

export function toolDetailStatus(pair: NativeChatToolPair): ToolDetailStatus {
  if (pair.result) {
    return pair.result.isError ? 'Failed' : 'Completed'
  }
  if (pair.call?.state === 'failed') {
    return 'Failed'
  }
  if (pair.call?.state === 'completed') {
    return 'Completed'
  }
  return 'Running'
}

/** The sheet's title: the row's own sentence, reused for one call instead of
 *  a whole run so "Ran a command" / "Messaged @agent" stays one source of
 *  truth with the collapsed row (`toolRunSentence`) rather than a second
 *  wording invented for the sheet. Falls back to the bare tool name when the
 *  call is nameless or the pair is a result with no call at all. */
export function toolDetailTitle(pair: NativeChatToolPair): string {
  const blocks: NativeChatBlock[] = []
  if (pair.call) {
    blocks.push(pair.call)
  }
  if (pair.result) {
    blocks.push(pair.result)
  }
  const sentence = toolRunSentence(blocks)
  if (sentence) {
    return sentence
  }
  const name = pair.call?.name?.trim()
  return name && name.length > 0 ? name : 'Tool call'
}

/** Whether this pair already has a specialised inline card (an edit's diff
 *  card, a plan's checklist, a web search's result list) that says more than
 *  the sheet's generic name/value rows would. Those keep their existing
 *  inline row instead of opening the sheet — the sheet is for everything
 *  else, which today falls back to a bare label or raw JSON. */
export function toolPairHasSpecialInlineCard(
  pair: NativeChatToolPair,
  { isTaskList }: { isTaskList: boolean }
): boolean {
  if (isTaskList) {
    return true
  }
  const hasSearchResults = (pair.call?.webSearchResults?.length ?? 0) > 0
  if (hasSearchResults) {
    return true
  }
  if (!pair.call || !isEditToolName(pair.call.name)) {
    return false
  }
  const files = editFilesFromToolPair({
    name: pair.call.name,
    input: pair.call.input,
    ...(pair.call.state ? { state: pair.call.state } : {}),
    ...(pair.result
      ? {
          result: {
            output: pair.result.output,
            isError: pair.result.isError,
            editPatch: pair.result.editPatch
          }
        }
      : {})
  })
  return files !== null && files.length > 0
}

/** Whether tapping this row should open the detail sheet: there is a call or
 *  a result to show, and nothing else already renders a richer inline card
 *  for it. */
export function toolPairOpensDetailSheet(
  pair: NativeChatToolPair,
  options: { isTaskList: boolean }
): boolean {
  if (toolPairHasSpecialInlineCard(pair, options)) {
    return false
  }
  return pair.call !== undefined || pair.result !== undefined
}

export type ToolDetailInputRow = {
  name: string
  value: string
  /** Object/array values print as indented JSON; the sheet gives them a mono
   *  block instead of the plain-text style a string value gets. */
  isObject: boolean
}

function parseJsonIfLikely(value: string): unknown {
  const first = value.trimStart()[0]
  if (first !== '{' && first !== '[') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Codex delivers tool arguments as a JSON string; Claude's are already an
 *  object. Both end up as the same named-record shape so the sheet's row
 *  list does not care which wire produced the call. */
function normalizeInputRecord(input: unknown): Record<string, unknown> | null {
  const value = typeof input === 'string' ? parseJsonIfLikely(input) : input
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function formatInputValue(value: unknown): { value: string; isObject: boolean } {
  if (value === null || value === undefined) {
    return { value: '', isObject: false }
  }
  if (typeof value === 'string') {
    return { value, isObject: false }
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value: String(value), isObject: false }
  }
  try {
    return { value: JSON.stringify(value, null, 2) ?? '', isObject: true }
  } catch {
    return { value: String(value), isObject: true }
  }
}

/** One row per input key, name-sorted so the sheet reads the same way every
 *  time regardless of the wire's own key order — the evidence's "Messaged
 *  @…" sheet lists `content, message, recipient, summary, to, type`, which is
 *  alphabetical, not the order SendMessage's schema declares them in. A call
 *  whose input is not a named record (a bare string, an array, a number)
 *  still gets one row rather than an empty Inputs section. */
export function toolDetailInputRows(input: unknown): ToolDetailInputRow[] {
  const record = normalizeInputRecord(input)
  if (record) {
    return Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, ...formatInputValue(record[name]) }))
  }
  if (input === null || input === undefined || input === '') {
    return []
  }
  return [{ name: 'input', ...formatInputValue(input) }]
}

/** Whether the call's raw output parses as JSON, which is what earns the
 *  sheet's "Prettify" pill — plain stdout never gets one. */
export function toolDetailOutputIsJson(output: string): boolean {
  const trimmed = output.trim()
  if (!trimmed) {
    return false
  }
  const first = trimmed[0]
  if (first !== '{' && first !== '[') {
    return false
  }
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** Re-indented JSON for the Prettify toggle. Falls back to the raw string on
 *  any parse failure so the toggle can never blank the output it is showing
 *  (only called after `toolDetailOutputIsJson` said it would parse, but a
 *  second, cheaper guard here costs nothing and holds even if that changes). */
export function prettifyToolDetailOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2)
  } catch {
    return output
  }
}
