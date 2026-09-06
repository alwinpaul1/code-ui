import { hasCodexFooter } from './mobile-terminal-hud-parse'
// Codex's `/model` picker as it renders in the terminal screen buffer. Codex
// 0.153.x has no non-interactive way to set the model or reasoning effort
// mid-session — `/model <slug>` is unreliable and a second argument is sent to
// the model as chat — so the phone drives the picker: read the rows, move the
// `›` cursor with arrow keys, confirm with Enter. Everything here is a pure
// parse of screen lines; the driver lives in codex-picker-apply.ts.
//
// Model step (header "Select Model and Effort"):
//   "  1. gpt-6-astra (default)  Our most capable model for complex work."
//   "› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks."
// Effort step (header "Select Reasoning Level for <slug>"):
//   "  1. Low (default)         Fast responses with lighter reasoning"
//   "› 4. Extra high (current)  Extra high reasoning depth for complex problems"
//   "  5. More reasoning…       Max and Ultra consume usage limits faster"

export type CodexPickerRow = {
  /** 1-based number as printed. */
  index: number
  /** The slug (model step) or the effort label as printed (effort step). */
  name: string
  description: string
  isDefault: boolean
  isCurrent: boolean
  /** Effort step only: the "More reasoning…" expander row. */
  isMore: boolean
}

export type CodexPickerScreen = {
  step: 'model' | 'effort'
  /** Effort step: the slug the header names. */
  model: string | null
  rows: CodexPickerRow[]
  /** 1-based index the `›` cursor sits on, or null when not drawn. */
  cursorIndex: number | null
}

const MODEL_HEADER = /^\s*Select Model and Effort\s*$/
const EFFORT_HEADER = /^\s*Select Reasoning Level for\s+(\S+)\s*$/
const FOOTER = /Press enter to confirm or esc to go back/
// "› 2. gpt-5.6-sol (current)  description" — name runs to the flag or a
// two-space gap; the description is whatever follows.
const ROW = /^([›>]?)\s*(\d+)\.\s+(.+?)(?:\s+\((default|current)\))*(?:\s{2,}(.*))?$/

function parseRow(line: string): CodexPickerRow | null {
  const match = ROW.exec(line.trimStart())
  if (!match) {
    return null
  }
  const [, cursor, index, rawName, , description] = match
  // The regex consumes flags without keeping both; re-scan the line for them.
  const flags = line.match(/\((default|current)\)/g) ?? []
  const name = rawName!.trim()
  return {
    index: Number(index),
    name,
    description: (description ?? '').trim(),
    isDefault: flags.some((flag) => flag === '(default)'),
    isCurrent: flags.some((flag) => flag === '(current)'),
    isMore: /^More reasoning/i.test(name),
    ...(cursor ? {} : {})
  }
}

/**
 * Find the picker in a screen read. The picker paints below the transcript,
 * so the LAST header on screen is the live one; rows run from there to the
 * "Press enter" footer.
 */
export function parseCodexPickerScreen(lines: readonly string[]): CodexPickerScreen | null {
  let headerAt = -1
  let step: CodexPickerScreen['step'] | null = null
  let model: string | null = null
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    if (MODEL_HEADER.test(line)) {
      headerAt = index
      step = 'model'
      break
    }
    const effort = EFFORT_HEADER.exec(line)
    if (effort) {
      headerAt = index
      step = 'effort'
      model = effort[1] ?? null
      break
    }
  }
  if (headerAt < 0 || !step) {
    return null
  }
  const rows: CodexPickerRow[] = []
  let cursorIndex: number | null = null
  for (let index = headerAt + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FOOTER.test(line)) {
      break
    }
    const row = parseRow(line)
    if (!row) {
      continue
    }
    rows.push(row)
    if (/^[›>]/.test(line.trimStart())) {
      cursorIndex = row.index
    }
  }
  if (rows.length === 0) {
    return null
  }
  return { step, model, rows, cursorIndex }
}

/** Whether the Codex TUI is idle at its prompt with no turn running. The
 *  placeholder disappears once the composer holds a draft, so the footer line
 *  ("<model> <effort> · <cwd>") counts as evidence of the prompt too. */
export function isCodexIdle(lines: readonly string[]): boolean {
  const tail = lines.slice(-6).join('\n')
  if (/esc to interrupt/.test(tail) || parseCodexPickerScreen(lines)) {
    return false
  }
  return /Ask Codex to do anything/.test(tail) || hasCodexFooter(lines)
}

/** Whether a Codex turn is in progress (a stray Esc here would interrupt it). */
export function isCodexWorking(lines: readonly string[]): boolean {
  return /esc to interrupt/.test(lines.slice(-6).join('\n'))
}

/** Match a picker effort label ("Extra high") to a discovered level id ("xhigh"). */
export function matchCodexEffortRow(
  rows: readonly CodexPickerRow[],
  target: { id: string; label: string }
): CodexPickerRow | undefined {
  const wanted = new Set(
    [target.id, target.label].map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
  )
  return rows.find((row) => !row.isMore && wanted.has(row.name.trim().toLowerCase()))
}
