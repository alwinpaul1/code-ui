// Cancelling one message Claude Code has queued behind the running turn.
//
// Claude Code has no per-entry queue control; its documented mechanism is
// "press Up from the first line of the input box to take back the queued
// messages" — they land in the input box one per line, ahead of any draft —
// and Ctrl+K / Ctrl+U delete within a line without interrupting the turn (Esc
// would). So a cancel is: take everything back, clear the input, re-queue the
// entries the user kept, and restore the mirrored draft.

const KEY_UP = '\u001b[A'
const KEY_CTRL_K = '\u000b'
const KEY_CTRL_U = '\u0015'

export type TerminalWrite = { text: string; enter: boolean }

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

export function buildQueuedCancelWrites(args: {
  /** Every queued entry, oldest first, as Claude Code holds them. */
  queued: readonly string[]
  /** Index into `queued` of the entry to drop. */
  cancelIndex: number
  /** The phone's composer draft, which the mirror has typed onto the TUI line. */
  draft?: string
}): TerminalWrite[] {
  const { queued, cancelIndex } = args
  if (cancelIndex < 0 || cancelIndex >= queued.length) {
    return []
  }
  const draft = args.draft ?? ''
  const lines = queued.reduce((sum, text) => sum + lineCount(text), 0) + lineCount(draft)
  const writes: TerminalWrite[] = [{ text: KEY_UP, enter: false }]
  // Why Ctrl+K then Ctrl+U per line: a recalled line can leave the cursor at
  // its start, where Ctrl+U alone deletes nothing; the pair clears the line
  // from either side, and Ctrl+U on an empty line steps back across lines.
  // +2 spare rounds cover a trailing empty line; both keys are no-ops there.
  writes.push({ text: (KEY_CTRL_K + KEY_CTRL_U).repeat(lines + 2), enter: false })
  queued.forEach((text, index) => {
    if (index !== cancelIndex) {
      writes.push({ text, enter: true })
    }
  })
  if (draft) {
    writes.push({ text: draft, enter: false })
  }
  return writes
}
