import { foldWhitespace } from './mobile-background-task-transcript'

// ─── Claude Code's own Background dialog, read off the screen ────────────────
//
// What a Stop on a terminal tab drives (claude-background-task-stop.ts). Claude
// Code 2.1.296, captured live 2026-10-11 (fixtures/claude-busy-lead-tasks-2.1.296):
// with the input box focused and a "· N shells" pill on the footer's mode row, ↓
// focuses the pill (the row loses its "← for agents" hint) and Enter opens:
//
//   '  Background'
//   '  1 active shell · 1 active agent'          (or "No tasks currently running")
//   '    Shells (1)'                             (a heading only when both kinds run)
//   '  ❯ ⏺ sleep 200          running'           (a shell: its COMMAND, not its description)
//   '    Local agents (1)'
//   '    ⏺ Long probe agent   running · Opus 5.5' (an agent: its description)
//   '  ↑/↓ to select · Enter to view · x to stop · Esc to close'
//
// `x` stops the selected row at once, with no confirmation, and Esc closes the
// dialog and gives the input box its focus back; neither interrupts a working
// lead. It lists the lead's shells AND its subagents' (a subagent's `sleep 240`
// stopped from it), but not a foreground command. A long label is cut with "…"
// (at 48 columns: "cd /tmp && for i i…", "A rather long agen…"), and the hint row
// wraps.

export type ClaudeBackgroundDialogRow = {
  /** The label as drawn, ellipsis removed, whitespace folded. */
  label: string
  /** The label ended in "…": it is a prefix of the real one. */
  cut: boolean
  /** From the section heading, else from the summary line when one kind runs. */
  kind: 'shell' | 'agent' | null
  /** The word after the label: running, completed, failed, killed… */
  status: string
  selected: boolean
}

export type ClaudeBackgroundDialog = {
  rows: ClaudeBackgroundDialogRow[]
  /** The hint offers "x to stop" (absent when nothing runs). */
  canStop: boolean
}

const TITLE = /^ {2}Background\s*$/
const SUMMARY = /^ {2}(?:(\d+) active (shells?|agents?)(?: · (\d+) active (shells?|agents?))?|No tasks currently running)\s*$/
const HEADING = /^ {4}(Shells|Local agents) \(\d+\)\s*$/
/** Two columns, `❯ ` or two spaces, the dot, the label, at least two spaces,
 *  the status word, anything after (" · Opus 5.5"). */
const ROW = /^ {2}(❯ | {2})[⏺●] (.+?) {2,}([a-z]+)\b.*$/
const ESC_TO_CLOSE = /\bEsc to close\b/

/** The dialog when it is the last thing on screen, or null. Blank rows, kept or
 *  dropped (Orca's screen read drops them), are skipped. */
export function parseClaudeBackgroundDialog(lines: readonly string[]): ClaudeBackgroundDialog | null {
  const rows = lines.map((line) => line.replace(/\s+$/, '')).filter((line) => line !== '')
  const title = rows.findLastIndex((line) => TITLE.test(line))
  if (title === -1) {
    return null
  }
  const summary = SUMMARY.exec(rows[title + 1] ?? '')
  if (!summary) {
    return null
  }
  const rest = rows.slice(title + 2)
  const hintAt = rest.findIndex((line) => /\bto select\b/.test(line))
  if (hintAt === -1 || !rest.slice(hintAt, hintAt + 2).some((line) => ESC_TO_CLOSE.test(line)) || rest.length > hintAt + 2) {
    return null
  }
  const kinds = [summary[2], summary[4]].filter((kind): kind is string => kind !== undefined)
  const only: ClaudeBackgroundDialogRow['kind'] = kinds.length === 1 ? (kinds[0]!.startsWith('shell') ? 'shell' : 'agent') : null
  let kind = only
  const parsed: ClaudeBackgroundDialogRow[] = []
  for (const line of rest.slice(0, hintAt)) {
    const heading = HEADING.exec(line)
    if (heading) {
      kind = heading[1] === 'Shells' ? 'shell' : 'agent'
      continue
    }
    const row = ROW.exec(line)
    if (!row) {
      return null
    }
    const drawn = row[2]!.trim()
    const cut = drawn.endsWith('…')
    parsed.push({
      label: foldWhitespace(cut ? drawn.slice(0, -1) : drawn),
      cut,
      kind,
      status: row[3]!,
      selected: row[1] === '❯ '
    })
  }
  return { rows: parsed, canStop: rest.slice(hintAt, hintAt + 2).join(' ').includes('x to stop') }
}

export type ClaudeBackgroundStopTarget = {
  kind: 'shell' | 'agent'
  /** A shell's command, an agent's description: what the dialog draws. */
  label: string
}

export type ClaudeBackgroundRowMatch =
  | { found: true; index: number }
  | { found: false; reason: 'not-listed' | 'ambiguous' }

/** The one running row that is the target. A shell's command is compared by its
 *  first line, the way a one-line label can show it. Two rows that could both be
 *  it (two shells running the same command, two labels cut to the same prefix)
 *  are refused: stopping the wrong task is worse than not stopping. */
export function matchClaudeBackgroundRow(
  dialog: ClaudeBackgroundDialog,
  target: ClaudeBackgroundStopTarget
): ClaudeBackgroundRowMatch {
  const whole = foldWhitespace(target.label)
  const firstLine = foldWhitespace(target.label.split('\n').find((line) => line.trim() !== '') ?? '')
  const candidates = dialog.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.status === 'running' && (row.kind === null || row.kind === target.kind))
    .filter(({ row }) =>
      row.cut
        ? row.label !== '' && (whole.startsWith(row.label) || firstLine.startsWith(row.label))
        : row.label === whole || row.label === firstLine
    )
  if (candidates.length === 0) {
    return { found: false, reason: 'not-listed' }
  }
  if (candidates.length > 1) {
    return { found: false, reason: 'ambiguous' }
  }
  // A cut row matches by prefix: another running row of the same kind whose own
  // label shares that prefix could be the target too.
  const match = candidates[0]!
  if (match.row.cut) {
    const rivals = dialog.rows.filter(
      (row, index) =>
        index !== match.index &&
        row.status === 'running' &&
        (row.kind === null || row.kind === target.kind) &&
        (row.label.startsWith(match.row.label) || match.row.label.startsWith(row.label))
    )
    if (rivals.length > 0) {
      return { found: false, reason: 'ambiguous' }
    }
  }
  return { found: true, index: match.index }
}

/** The footer's mode row as a Stop needs it: whether it shows a shells pill, and
 *  whether the input box has the focus (its "← for agents" hint is drawn; the
 *  hint goes when ↓ moves the focus onto the pill, screen-shells-pill-focused.txt).
 *  Null when no mode row is on screen. */
export function readClaudeFooterFocus(lines: readonly string[]): { pill: boolean; inputFocused: boolean } | null {
  const tail = lines.slice(-12).map((line) => line.replace(/\s+$/, ''))
  const mode = tail.findLast((line) => /^ {2}(?:⏵⏵|⏸) /.test(line))
  if (mode === undefined) {
    return null
  }
  return { pill: /[·•]\s*\d+\s+shells?\b/.test(mode), inputFocused: /←\s*for\b/.test(mode) }
}

export type ClaudeShellDetails = {
  status: string
  /** The command as drawn, whitespace folded (a long one wraps onto more rows). */
  command: string
  canStop: boolean
}

const DETAILS_TITLE = /^ {2}Shell details\s*$/
const DETAILS_FIELD = /^ {2}(Status|Runtime|Command|Output):\s*(.*)$/

/** Claude Code's Shell details view, or null. With exactly one task running, Enter on
 *  the footer's pill opens it straight away, in place of the list (live, 2026-10-11,
 *  screen-shell-details.txt):
 *
 *    '  Shell details'
 *    '  Status:   running'
 *    '  Runtime:  49s'
 *    '  Command:  sleep 400'
 *    '  Output:'
 *    '  No output available'
 *    '  ← to go back · Esc/Enter/Space to close · x to stop'
 *
 *  `x` there stops the shell and closes the view itself, back to the input box: no
 *  Esc is needed after it, and none may be sent (on the input box Esc would
 *  interrupt a working lead). */
export function parseClaudeShellDetails(lines: readonly string[]): ClaudeShellDetails | null {
  const rows = lines.map((line) => line.replace(/\s+$/, '')).filter((line) => line !== '')
  const title = rows.findLastIndex((line) => DETAILS_TITLE.test(line))
  if (title === -1) {
    return null
  }
  const rest = rows.slice(title + 1)
  const hintAt = rest.findIndex((line) => /\bto close\b/.test(line) || /\bto go back\b/.test(line))
  if (hintAt === -1 || rest.length > hintAt + 2) {
    return null
  }
  let status: string | null = null
  const command: string[] = []
  let field: string | null = null
  for (const line of rest.slice(0, hintAt)) {
    const match = DETAILS_FIELD.exec(line)
    if (match) {
      field = match[1]!
      if (field === 'Status') {
        status = match[2]!.trim()
      } else if (field === 'Command') {
        command.push(match[2]!)
      }
    } else if (field === 'Command') {
      command.push(line)
    }
  }
  if (status === null || command.length === 0) {
    return null
  }
  return {
    status,
    command: foldWhitespace(command.join(' ')),
    canStop: rest.slice(hintAt, hintAt + 2).join(' ').includes('x to stop')
  }
}

/** Whether a shell's command is the one a details view draws. */
export function shellDetailsMatch(details: ClaudeShellDetails, target: ClaudeBackgroundStopTarget): boolean {
  if (target.kind !== 'shell') {
    return false
  }
  const whole = foldWhitespace(target.label)
  const drawn = details.command.endsWith('…') ? details.command.slice(0, -1) : details.command
  return details.command.endsWith('…') ? drawn !== '' && whole.startsWith(drawn) : drawn === whole
}
