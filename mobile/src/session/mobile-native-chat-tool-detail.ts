import { isEditToolName, editFilesFromToolPair } from '../../../src/shared/native-chat-edit-normalize'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { truncateToolDetail } from '../../../src/shared/native-chat-tool-summary'
import { mcpToolIdentity } from '../../../src/shared/native-chat-tool-identity'
import { sendMessageAddressee, toolCallKind } from './mobile-native-chat-tool-sentence'

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

/** The sheet's title: the tool's own name, the way the Claude app titles it
 *  ("Bash" over "Completed", 2026-10-10 screenshots). It was the row's
 *  sentence ("Ran a command"), which only repeated the row just tapped. An MCP
 *  tool reads as its row names it ("Gmail / search threads"). A SendMessage
 *  keeps "Messaged @<recipient>", the Claude app's title for that sheet
 *  (2026-09-26 screenshots). A result with no call to name is a "Tool call". */
export function toolDetailTitle(pair: NativeChatToolPair): string {
  if (pair.call && toolCallKind(pair.call.name) === 'message') {
    const to = sendMessageAddressee(pair.call.input)
    return to ? `Messaged ${to}` : 'Messaged an agent'
  }
  const name = pair.call?.name?.trim()
  if (!name) {
    return 'Tool call'
  }
  const mcp = mcpToolIdentity(name, pair.call?.mcpIdentity)
  return mcp ? `${mcp.server} / ${mcp.tool}` : name
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
  /** Prose the agent wrote as Markdown (a SendMessage's message, an Agent's
   *  prompt): the sheet renders it, rather than drawing `**` and backticks as
   *  text (the user, 2026-09-28: "Fix the formatting"). Set only when true. */
  isMarkdown?: true
}

/** The inputs of each tool that carry Markdown prose. Everything else, a Bash
 *  `command` above all, stays literal text. */
const MARKDOWN_INPUTS: Readonly<Record<string, readonly string[]>> = {
  SendMessage: ['content', 'message'],
  Agent: ['prompt'],
  Task: ['prompt']
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
 *  still gets one row rather than none. The sheet lists a SendMessage this
 *  way (mobile-native-chat-tool-detail-sections.ts). */
export function toolDetailInputRows(input: unknown, toolName?: string | null): ToolDetailInputRow[] {
  const record = normalizeInputRecord(input)
  if (record) {
    const markdownNames = (toolName ? MARKDOWN_INPUTS[toolName] : undefined) ?? []
    return Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const row = boundedRow(name, record[name])
        return !row.isObject && markdownNames.includes(name) ? { ...row, isMarkdown: true as const } : row
      })
  }
  if (input === null || input === undefined || input === '') {
    return []
  }
  return [boundedRow('input', input)]
}

// Why: the inline row capped a call's detail before native text layout, and a
// tap now opens this sheet instead; one 100 KB string in an Android Text
// stalls the UI thread. Same cap, same ellipsis.
function boundedRow(name: string, raw: unknown): ToolDetailInputRow {
  const { value, isObject } = formatInputValue(raw)
  return { name, value: truncateToolDetail(value), isObject }
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
