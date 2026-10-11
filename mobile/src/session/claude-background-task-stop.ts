import { readClaudeInput } from './claude-composer-screen'
import {
  matchClaudeBackgroundRow,
  parseClaudeBackgroundDialog,
  parseClaudeShellDetails,
  readClaudeFooterFocus,
  shellDetailsMatch,
  type ClaudeBackgroundDialog,
  type ClaudeBackgroundStopTarget
} from './claude-background-dialog'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { terminalDialogOnScreen } from './mobile-native-chat-dialog-guard'

// ─── Stopping one background task on a terminal-driven Claude tab ────────────
//
// Stock Orca has no stop for a terminal tab's background task, and Claude Code
// takes no command that names one. What it has is its own Background dialog,
// driven by its own keys (claude-background-dialog.ts, verified live on Claude
// Code 2.1.296, 2026-10-11): ↓ from the input box focuses the footer's
// "N shells" pill, Enter opens the dialog, the arrows select a row, `x` stops it,
// Esc closes the dialog and hands the input box its focus back. With exactly one
// task running, Enter opens that task's Shell details in place of the list, and
// `x` there stops it and closes the view itself. Nothing is typed
// into the input box and nothing of ours is drawn: the screen the user sees for a
// second is Claude's own dialog, and it is closed again.
//
// Every key is sent only on a screen that says where it will land, and read back
// before the next:
//  - ↓ only with the input box located, no dialog or menu up, and the footer's
//    mode row showing a shells pill AND the "← for agents" hint (the input box
//    has the focus). With no pill Claude has no Background dialog to open (↓
//    then focuses the agent panel, whose rows Claude retitles with its own
//    summaries and cannot be matched), so the phone offers no Stop there.
//  - Enter only once the mode row has lost the "← for agents" hint: the pill has
//    the focus. Enter on the input box would submit what is in it, a prompt
//    suggestion included.
//  - `x` only with the target row selected and matched exactly once.
//  - Esc only while the dialog (or the focused pill, or the agent panel) is on
//    screen. Esc on the input box interrupts a working lead; in the dialog and
//    on the pill it does not (checked against a working lead).
// Anything unexpected stops the drive, closes what it opened, and says why.
//
// Never tried: ← (it moves the whole conversation into Claude's session manager
// and re-forks the session into a background process, 2026-10-11) and `/tasks`
// (typed into the input box).

const KEY_DOWN = '\x1b[B'
const KEY_UP = '\x1b[A'
const KEY_ENTER = '\r'
const KEY_ESC = '\x1b'
const KEY_STOP = 'x'
const POLL_MS = 120
const STEP_TIMEOUT_MS = 3_000

export type ClaudeBackgroundStopIo = {
  readScreen: () => Promise<string[] | null>
  /** One raw write; false when the host refused it. */
  sendKey: (keys: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export type ClaudeBackgroundStopResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'unreadable'
        | 'dialog-up'
        | 'no-input-box'
        | 'no-task-list'
        | 'not-focused'
        | 'no-dialog'
        | 'not-listed'
        | 'ambiguous'
        | 'cursor'
        | 'unconfirmed'
        | 'send-failed'
      /** What the sheet says. */
      message: string
    }

const MESSAGES: Record<Exclude<ClaudeBackgroundStopResult, { ok: true }>['reason'], string> = {
  unreadable: "Couldn't read the desktop screen, so nothing was stopped.",
  'dialog-up': "A prompt is open in Claude on the desktop. Answer it first, then stop the task.",
  'no-input-box': "Claude's input box isn't on the desktop screen, so nothing was stopped.",
  'no-task-list': "Claude isn't showing its task list on the desktop right now, so nothing was stopped.",
  'not-focused': "Claude didn't open its task list, so nothing was stopped.",
  'no-dialog': "Claude didn't open its task list, so nothing was stopped.",
  'not-listed': "Claude's task list doesn't show this task running, so nothing was stopped.",
  ambiguous: "Claude's task list shows more than one task like this, so nothing was stopped. Stop it on the desktop.",
  cursor: "Couldn't select the task in Claude's list, so nothing was stopped.",
  unconfirmed: "Stop sent, but Claude's list didn't confirm it. Check on the desktop.",
  'send-failed': "Couldn't send the keys to the desktop, so nothing was stopped."
}

const fail = (reason: keyof typeof MESSAGES): ClaudeBackgroundStopResult => ({ ok: false, reason, message: MESSAGES[reason] })

/** Claude's agent panel has the focus: its "↑/↓ to select" hint in place of the
 *  footer's mode row, and a selected panel row. */
function agentPanelFocused(lines: readonly string[]): boolean {
  const tail = lines.slice(-12)
  return tail.some((line) => /^ {2}↑\/↓ to select\s*$/.test(line)) && tail.some((line) => /^❯ (?: {2})*(?:[├└] )?[◯⏺●⏸]/.test(line))
}

async function waitFor<T>(io: ClaudeBackgroundStopIo, read: (lines: string[]) => T | null): Promise<T | null> {
  const deadline = io.now() + STEP_TIMEOUT_MS
  for (;;) {
    const lines = await io.readScreen()
    const value = lines ? read(lines) : null
    if (value !== null) {
      return value
    }
    if (io.now() >= deadline) {
      return null
    }
    await io.sleep(POLL_MS)
  }
}

/** Closes what this drive opened: Esc while the dialog, the focused pill or the
 *  agent panel is on screen, never on the input box. */
async function closeWhatWeOpened(io: ClaudeBackgroundStopIo): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lines = await io.readScreen()
    if (!lines) {
      return
    }
    const footer = readClaudeFooterFocus(lines)
    const pillFocused = footer !== null && footer.pill && !footer.inputFocused
    const ours = parseClaudeBackgroundDialog(lines) ?? parseClaudeShellDetails(lines)
    if (!ours && !pillFocused && !agentPanelFocused(lines)) {
      return
    }
    await io.sendKey(KEY_ESC)
    await io.sleep(POLL_MS)
  }
}

export async function stopClaudeBackgroundTask(
  io: ClaudeBackgroundStopIo,
  target: ClaudeBackgroundStopTarget
): Promise<ClaudeBackgroundStopResult> {
  const before = await io.readScreen()
  if (!before) {
    return fail('unreadable')
  }
  if (parseClaudeBackgroundDialog(before) || terminalDialogOnScreen(before, 'claude')) {
    return fail('dialog-up')
  }
  if (!readClaudeInput(before, '').located) {
    return fail('no-input-box')
  }
  const footer = readClaudeFooterFocus(before)
  if (!footer?.pill || !footer.inputFocused) {
    return fail('no-task-list')
  }
  if (!(await io.sendKey(KEY_DOWN))) {
    return fail('send-failed')
  }
  const focused = await waitFor(io, (lines) => {
    const now = readClaudeFooterFocus(lines)
    return now?.pill && !now.inputFocused ? true : null
  })
  if (!focused) {
    await closeWhatWeOpened(io)
    return fail('not-focused')
  }
  if (!(await io.sendKey(KEY_ENTER))) {
    await closeWhatWeOpened(io)
    return fail('send-failed')
  }
  const opened = await waitFor(io, (lines) => {
    const list = parseClaudeBackgroundDialog(lines)
    if (list) {
      return { list }
    }
    const details = parseClaudeShellDetails(lines)
    return details ? { details } : null
  })
  if (!opened) {
    await closeWhatWeOpened(io)
    return fail('no-dialog')
  }
  const result = opened.list
    ? await stopInDialog(io, opened.list, target)
    : await stopInDetails(io, opened.details, target, parseClaudeRunningShellCount(before))
  await closeWhatWeOpened(io)
  return result
}

/** The one-task case: the details view of the only running task. */
async function stopInDetails(
  io: ClaudeBackgroundStopIo,
  details: NonNullable<ReturnType<typeof parseClaudeShellDetails>>,
  target: ClaudeBackgroundStopTarget,
  shellsBefore: number | null
): Promise<ClaudeBackgroundStopResult> {
  if (!shellDetailsMatch(details, target) || details.status !== 'running') {
    return fail('not-listed')
  }
  if (!details.canStop) {
    return fail('cursor')
  }
  if (!(await io.sendKey(KEY_STOP))) {
    return fail('send-failed')
  }
  // Stopped: the view closes by itself and the footer counts one shell fewer.
  const gone = await waitFor(io, (lines) => {
    if (parseClaudeShellDetails(lines) || parseClaudeBackgroundDialog(lines)) {
      return null
    }
    const after = parseClaudeRunningShellCount(lines)
    return shellsBefore !== null && after !== null && after < shellsBefore ? true : null
  })
  return gone ? { ok: true } : fail('unconfirmed')
}

async function stopInDialog(
  io: ClaudeBackgroundStopIo,
  dialog: ClaudeBackgroundDialog,
  target: ClaudeBackgroundStopTarget
): Promise<ClaudeBackgroundStopResult> {
  const match = matchClaudeBackgroundRow(dialog, target)
  if (!match.found) {
    return fail(match.reason)
  }
  const cursor = dialog.rows.findIndex((row) => row.selected)
  if (cursor === -1 || !dialog.canStop) {
    return fail('cursor')
  }
  const delta = match.index - cursor
  if (delta !== 0 && !(await io.sendKey((delta > 0 ? KEY_DOWN : KEY_UP).repeat(Math.abs(delta))))) {
    return fail('send-failed')
  }
  const wanted = dialog.rows[match.index]!
  const landed = await waitFor(io, (lines) => {
    const now = parseClaudeBackgroundDialog(lines)
    const selected = now?.rows.find((row) => row.selected)
    if (!now || !selected) {
      return null
    }
    // The list must still be the one matched against: the same row selected and
    // still the only match.
    const again = matchClaudeBackgroundRow(now, target)
    return selected.label === wanted.label && again.found && now.rows[again.index]!.selected ? now : null
  })
  if (!landed) {
    return fail('cursor')
  }
  if (!(await io.sendKey(KEY_STOP))) {
    return fail('send-failed')
  }
  // Stopped: the row leaves the list (or no longer runs).
  const gone = await waitFor(io, (lines) => {
    const now = parseClaudeBackgroundDialog(lines)
    if (!now) {
      return null
    }
    const before = landed.rows.filter((row) => row.status === 'running').length
    const after = now.rows.filter((row) => row.status === 'running').length
    return after < before && !matchClaudeBackgroundRow(now, target).found ? true : null
  })
  return gone ? { ok: true } : fail('unconfirmed')
}
