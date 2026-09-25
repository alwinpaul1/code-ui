import { getTerminalLiveSpecialKeyBytes } from './terminal-live-input'
import { readUtf8CodePointAt } from '../../../src/shared/utf8-byte-limits'

export type TerminalLiveSpecialKeyDecision =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'local-edit' }
  | { readonly kind: 'send-now'; readonly bytes: string }
  | { readonly kind: 'commit-held-then-send'; readonly bytes: string }

export type TerminalLiveSpecialKeyDecisionInput = {
  readonly key: string
  readonly heldText: string
  readonly sentText: string
}

export type TerminalLiveAccessoryLocalEdit = 'backspace' | 'delete'

export type TerminalLiveAccessoryBytesDecision =
  | { readonly kind: 'local-edit'; readonly localEdit: TerminalLiveAccessoryLocalEdit }
  | { readonly kind: 'send-now'; readonly bytes: string }
  | { readonly kind: 'commit-held-then-send'; readonly bytes: string }

export type TerminalLiveAccessoryBytesDecisionInput = {
  readonly bytes: string
  readonly localEdit?: TerminalLiveAccessoryLocalEdit
  readonly heldText: string
  readonly sentText: string
}

export function getTerminalLiveSpecialKeyDecision({
  key,
  heldText,
  sentText
}: TerminalLiveSpecialKeyDecisionInput): TerminalLiveSpecialKeyDecision {
  const bytes = getTerminalLiveSpecialKeyBytes(key)
  if (bytes === null) {
    return { kind: 'ignore' }
  }

  // Why: native field edits fire onChangeText and the mirror diff emits the
  // matching PTY erase; sending raw DEL here as well would double-erase.
  if ((key === 'Backspace' || key === 'Delete') && (heldText.length > 0 || sentText.length > 0)) {
    return { kind: 'local-edit' }
  }

  if (heldText.length > 0) {
    return { kind: 'commit-held-then-send', bytes }
  }

  return { kind: 'send-now', bytes }
}

/**
 * Whether this control ends the line, which is what ends the field's editing session.
 *
 * The field holds a mirror of text the PTY has already echoed, so after a carriage return the
 * terminal owns it and the mirror must restart from empty — the same rule `flushPendingLiveInputText`
 * states for an explicit flush. `endsWith` rather than equality because a custom key may carry a
 * command and its return in one payload; a return in the middle is a line inside that payload, not
 * the end of this one.
 */
export function terminalLiveAccessoryInputEndsLine(bytes: string): boolean {
  return bytes.endsWith('\r')
}

export function getTerminalLiveAccessoryBytesDecision({
  bytes,
  localEdit,
  heldText,
  sentText
}: TerminalLiveAccessoryBytesDecisionInput): TerminalLiveAccessoryBytesDecision {
  if (localEdit && (heldText.length > 0 || sentText.length > 0)) {
    return { kind: 'local-edit', localEdit }
  }

  if (heldText.length > 0) {
    return { kind: 'commit-held-then-send', bytes }
  }

  return { kind: 'send-now', bytes }
}

export function getTerminalLiveAccessoryLocalEditText({
  localEdit,
  fieldText
}: {
  readonly localEdit: TerminalLiveAccessoryLocalEdit
  readonly fieldText: string
}): string {
  if (localEdit === 'delete') {
    // Why: accessory Delete mirrors forward-delete at the hidden input's end;
    // it stays local but does not remove the field text.
    return fieldText
  }

  const end = fieldText.length
  const width = end > 1 && readUtf8CodePointAt(fieldText, end - 2) > 0xffff ? 2 : 1
  return fieldText.slice(0, -width)
}

// Cursor-repositioning and line-mutating control bytes sent from the accessory
// strip. The live mirror tracks a single linear run of typed text and diffs it
// against the field; it cannot represent a cursor the TUI moved on its own. So
// once one of these reaches the PTY the mirror's model is stale, and the next
// typed run must start fresh at the TUI's new cursor. Resetting after these
// keys is what lets a recalled prompt (↑) be edited in place: move with the
// arrows, then type, and each character inserts where the TUI cursor sits.
const TERMINAL_LIVE_CURSOR_REPOSITION_BYTES: ReadonlySet<string> = new Set([
  '\x1b[A', // ↑ history / line up
  '\x1b[B', // ↓ history / line down
  '\x1b[C', // → right
  '\x1b[D', // ← left
  '\x1b[H', // Home
  '\x1b[F', // End
  '\x1bOH', // Home (application cursor keys)
  '\x1bOF', // End (application cursor keys)
  '\x01', // Ctrl+A, start of line
  '\x05', // Ctrl+E, end of line
  '\x17' // Ctrl+W, delete word backward
])

export function isTerminalLiveCursorRepositionBytes(bytes: string): boolean {
  return TERMINAL_LIVE_CURSOR_REPOSITION_BYTES.has(bytes)
}
