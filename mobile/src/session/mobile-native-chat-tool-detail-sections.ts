import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { toolFilePath, truncateToolDetail } from '../../../src/shared/native-chat-tool-summary'
import { toolCallKind } from './mobile-native-chat-tool-kind'
import { toolDetailInputRows, type ToolDetailInputRow } from './mobile-native-chat-tool-detail'

/**
 * The labelled boxes of the Claude app's tool sheet (2026-10-10 screenshots of
 * a Bash call: "Description", "Command", "Output", each a small muted label
 * over an inset box). One section per thing the call carries; a section with
 * nothing in it is left out, never drawn empty.
 *
 * - `prose`: the UI face, wrapping (a Bash description).
 * - `markdown`: prose the agent wrote as Markdown (an Agent's prompt).
 * - `code`: the code face, never wrapped; `language` tints it.
 * - `changes`: the edit's diff, drawn from the pair by the sheet.
 * - `inputs`: the Claude app's list for a tool it has no layout for: the heading
 *   "Inputs" (`ccr_tool_inputs`), then each input as a small muted name over its
 *   value, with no box (`ne9`:307, `xv1`:377-410 in the 1.261009.20 decompile).
 */
export type ToolDetailSection =
  | { kind: 'prose'; label: string; value: string }
  | { kind: 'markdown'; label: string; value: string }
  | { kind: 'code'; label: string; value: string; language: string | null }
  | { kind: 'changes'; label: string }
  | { kind: 'inputs'; label: string; rows: ToolDetailInputRow[] }

/** Lines of output the sheet draws before it says how many it left out. */
export const TOOL_DETAIL_OUTPUT_LINE_CAP = 400

function parseRecord(input: unknown): Record<string, unknown> | null {
  let value = input
  if (typeof input === 'string' && /^\s*[{[]/.test(input)) {
    try {
      value = JSON.parse(input)
    } catch {
      return null
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** One argv word as a shell would need it typed: bare when it is safe, else
 *  single-quoted. Joined by spaces alone, `["bash", "-lc", "echo 'a b'"]`
 *  read as a different command (review, 2026-10-10). */
function shellWord(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) {
    return word
  }
  return `'${word.replace(/'/g, `'"'"'`)}'`
}

/** The whole command, unclipped, and the key it came from: Claude's
 *  `command`, Codex's `cmd`, either as a string or as an argv array. */
function commandOf(record: Record<string, unknown>): { command: string; key: string } | null {
  for (const key of ['command', 'cmd']) {
    const value = record[key]
    if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string')) {
      return { command: value.map(shellWord).join(' '), key }
    }
    const single = text(value)
    if (single) {
      return { command: single, key }
    }
  }
  return null
}

function indentedJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const prose = (label: string, value: string | null): ToolDetailSection[] =>
  value ? [{ kind: 'prose', label, value: truncateToolDetail(value) }] : []
const code = (label: string, value: string | null, language: string | null = null): ToolDetailSection[] =>
  value ? [{ kind: 'code', label, value: truncateToolDetail(value), language }] : []
const markdown = (label: string, value: string | null): ToolDetailSection[] =>
  value ? [{ kind: 'markdown', label, value: truncateToolDetail(value) }] : []

/** The `inputs` section for a call's input, or nothing when it has none (the
 *  Claude app draws no "Inputs" heading over an empty map, `y030`:1594). */
function inputsSection(input: unknown, toolName: string): ToolDetailSection[] {
  const rows = toolDetailInputRows(input, toolName, { compact: true })
  return rows.length > 0 ? [{ kind: 'inputs', label: 'Inputs', rows }] : []
}

/** What the sheet shows of a call's input, by what the tool did. A tool this
 *  does not know lays its input out as the Claude app does: an "Inputs" list,
 *  one name over its value per key (a SendMessage, an MCP tool, a TaskCreate).
 *  The Output is the sheet's own section. */
export function toolDetailSections(
  pair: NativeChatToolPair,
  { hasChanges = false }: { hasChanges?: boolean } = {}
): ToolDetailSection[] {
  return resolveSections(pair, hasChanges).sections
}

/** Whether the call has no layout of its own, so the sheet answers it the way
 *  the Claude app's fallback does: "Inputs", then "Result" or "Error" as
 *  prose, no boxes. */
export function toolDetailIsGeneric(pair: NativeChatToolPair, hasChanges = false): boolean {
  return resolveSections(pair, hasChanges).generic
}

/** The kinds the Claude app gives a layout of their own (Bash, Read, Edit, Grep, Glob,
 *  Task: `lwy` in the decompile), which keep the "Output" box. Everything it files
 *  under `Other` gets the "Inputs" and "Result" fallback. */
const HAS_OWN_LAYOUT: ReadonlySet<ReturnType<typeof toolCallKind>> = new Set(['command', 'read', 'edit', 'search', 'agent'])

function resolveSections(
  pair: NativeChatToolPair,
  hasChanges: boolean
): { sections: ToolDetailSection[]; generic: boolean } {
  const call = pair.call
  if (!call) {
    return { sections: [], generic: true }
  }
  const kind = toolCallKind(call.name)
  if (kind === 'message') {
    return { sections: inputsSection(call.input, call.name), generic: true }
  }
  const record = parseRecord(call.input)
  // A proposed plan opens as the plan itself, under the Claude app's "Plan"
  // (`ccr_tool_exit_plan_mode`), not as an input named `plan`.
  const plan = call.name.trim() === 'ExitPlanMode' ? text(record?.plan) : null
  if (plan) {
    return { sections: markdown('Plan', plan), generic: true }
  }
  if (record) {
    const known = knownSections(kind, record, hasChanges)
    if (known) {
      return { sections: known, generic: false }
    }
  }
  return { sections: inputsSection(call.input, call.name), generic: !HAS_OWN_LAYOUT.has(kind) }
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path'] as const

/** The sections a known tool's input earns, then every input they did not
 *  use, as indented JSON under "Options" (a Read's offset and limit, a Bash
 *  call's timeout), so nothing the old name/value rows showed is lost (review,
 *  2026-10-10). Null when the input is not the shape the tool's layout needs. */
function knownSections(
  kind: ReturnType<typeof toolCallKind>,
  record: Record<string, unknown>,
  hasChanges: boolean
): ToolDetailSection[] | null {
  const laid = layoutFor(kind, record, hasChanges)
  if (!laid) {
    return null
  }
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !laid.used.includes(key)))
  return Object.keys(rest).length > 0 ? [...laid.sections, ...code('Options', indentedJson(rest))] : laid.sections
}

function layoutFor(
  kind: ReturnType<typeof toolCallKind>,
  record: Record<string, unknown>,
  hasChanges: boolean
): { sections: ToolDetailSection[]; used: readonly string[] } | null {
  const command = commandOf(record)
  const path = toolFilePath(record)
  const pattern = text(record.pattern) ?? text(record.query)
  // Codex keeps the raw command on a classified read/search/list row: it is a
  // command, and reads as one, with its path among the Options.
  if (command && (kind === 'command' || kind === 'read' || kind === 'search')) {
    return {
      sections: [...prose('Description', text(record.description)), ...code('Command', command.command, 'bash')],
      used: [command.key, 'description']
    }
  }
  if (kind === 'read' && path) {
    return { sections: code('File', path), used: PATH_KEYS }
  }
  // Only an edit the diff card can draw: the card is the whole input. A
  // NotebookEdit, or an edit that did not land, shows its whole Input instead.
  if (kind === 'edit' && hasChanges) {
    return { sections: [...code('File', path), { kind: 'changes', label: 'Changes' }], used: Object.keys(record) }
  }
  if (kind === 'search' && pattern) {
    return {
      sections: [...code('Pattern', pattern), ...code('Path', text(record.path))],
      used: ['pattern', 'query', 'path']
    }
  }
  if (kind === 'agent' && (text(record.description) || text(record.prompt))) {
    return {
      sections: [...prose('Description', text(record.description)), ...markdown('Prompt', text(record.prompt))],
      used: ['description', 'prompt']
    }
  }
  return null
}

/** The output's first {@link TOOL_DETAIL_OUTPUT_LINE_CAP} lines, then the
 *  shared character cap the inline row always had (a 100 KB string in one
 *  Android Text stalls the UI thread), and how many lines neither let through. */
export function capToolDetailOutput(output: string): { text: string; hiddenLines: number } {
  const lines = output.split('\n')
  // A trailing newline ends the last line; it does not start another.
  const total = lines.length - (lines.length > 1 && lines.at(-1) === '' ? 1 : 0)
  const kept = lines.length > TOOL_DETAIL_OUTPUT_LINE_CAP ? lines.slice(0, TOOL_DETAIL_OUTPUT_LINE_CAP).join('\n') : output
  const capped = truncateToolDetail(kept)
  // A cap that cut right after a newline puts its ellipsis on a line of its
  // own, which is not a line of the output.
  const shownLines =
    capped === output ? total : capped.split('\n').length - (capped.endsWith('\n…') ? 1 : 0)
  return { text: capped, hiddenLines: Math.max(0, total - shownLines) }
}
