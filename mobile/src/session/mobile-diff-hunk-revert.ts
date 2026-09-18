// The post-apply half of the extension's per-hunk accept/reject (2.1.275):
// "Revert this hunk" on the diff card of an edit that already landed. The
// pre-acceptance half is not possible here — `respondToApproval` takes an
// option id and nothing else, so the phone cannot answer a permission with an
// edited input.
//
// This module never touches the host. It takes the card, the hunk and the
// file's CURRENT content, and says what the file would become — or why it will
// not say. The refusals are the point: a revert applied against the snapshot
// the card was drawn from would silently overwrite whatever the agent or the
// user did to those lines since.

import type {
  NativeChatEditFile,
  NativeChatEditLine
} from '../../../src/shared/native-chat-edit-model'
import { buildMobileDiffHunks, type MobileDiffHunk } from './mobile-diff-hunks'
import type { MobileDiffLine } from './mobile-diff-lines'

/** Context rows a hunk carries on each side into the file, as unified diff does. */
const ANCHOR_CONTEXT_ROWS = 3

export type HunkRevertRefusal =
  | 'no-such-hunk'
  | 'whole-file-change'
  | 'hunk-cut-by-truncation'
  | 'no-anchor'
  | 'drifted'
  | 'ambiguous'
  | 'already-back'
  | 'mixed-line-endings'

export const HUNK_REVERT_REFUSAL_MESSAGES: Record<HunkRevertRefusal, string> = {
  'no-such-hunk': 'This hunk is no longer on the card.',
  'whole-file-change':
    'This card is a whole file being written; what it replaced is not on the card. Revert it from the file explorer or git.',
  'hunk-cut-by-truncation': 'The diff was cut off inside this hunk; open the diff to revert by hand.',
  'no-anchor': 'This hunk has no surrounding lines to anchor on; open the diff to revert by hand.',
  drifted: 'This part of the file changed since; open the diff to revert by hand.',
  ambiguous: 'This change appears more than once in the file; open the diff to revert by hand.',
  'already-back': 'The removed lines are already back in the file; there is nothing to revert.',
  'mixed-line-endings': 'This file mixes line endings; open the diff to revert by hand.'
}

export type HunkRevertPlan =
  | {
      ok: true
      /** The whole file after the revert, in the file's own line endings. */
      content: string
      /** Lines the revert takes out (the hunk's new side). */
      removed: number
      /** Lines the revert puts back (the hunk's old side). */
      restored: number
    }
  | { ok: false; refusal: HunkRevertRefusal; message: string }

function refuse(refusal: HunkRevertRefusal): Extract<HunkRevertPlan, { ok: false }> {
  return { ok: false, refusal, message: HUNK_REVERT_REFUSAL_MESSAGES[refusal] }
}

/** The card's row model, in the shape the review screen's hunk parser reads.
 *  A gap carries no text and no number; as a context row it still does the one
 *  thing that matters here, which is to end the hunk before it. */
function toReviewLine(line: NativeChatEditLine): MobileDiffLine {
  switch (line.kind) {
    case 'add':
      return line.newLineNumber === null
        ? { kind: 'add', text: line.text }
        : { kind: 'add', text: line.text, newLineNumber: line.newLineNumber }
    case 'del':
      return line.oldLineNumber === null
        ? { kind: 'delete', text: line.text }
        : { kind: 'delete', text: line.text, oldLineNumber: line.oldLineNumber }
    case 'context':
      return {
        kind: 'context',
        text: line.text,
        ...(line.oldLineNumber === null ? {} : { oldLineNumber: line.oldLineNumber }),
        ...(line.newLineNumber === null ? {} : { newLineNumber: line.newLineNumber })
      }
    case 'gap':
      return { kind: 'context', text: '' }
    default: {
      const never: never = line.kind
      throw new Error(`unhandled edit row kind ${String(never)}`)
    }
  }
}

/** The contiguous change blocks on a card — one "Revert this hunk" each. Reuses
 *  the review screen's grouping so the two surfaces cannot disagree about what a
 *  hunk is. */
export function editCardHunks(file: NativeChatEditFile): MobileDiffHunk[] {
  return buildMobileDiffHunks(file.lines.map(toReviewLine))
}

type HunkSides = {
  /** Context rows just above the hunk, oldest first. */
  before: string[]
  /** What the edit removed: the lines to put back. */
  oldSide: string[]
  /** What the edit added: the lines the file should still hold. */
  newSide: string[]
  /** Context rows just below the hunk. */
  after: string[]
}

function hunkSides(lines: readonly NativeChatEditLine[], hunk: MobileDiffHunk): HunkSides {
  const oldSide: string[] = []
  const newSide: string[] = []
  for (let index = hunk.startIndex; index <= hunk.endIndex; index += 1) {
    const line = lines[index]
    if (line?.kind === 'add') {
      newSide.push(line.text)
    } else if (line?.kind === 'del') {
      oldSide.push(line.text)
    }
  }
  const before: string[] = []
  for (let index = hunk.startIndex - 1; index >= 0 && before.length < ANCHOR_CONTEXT_ROWS; index -= 1) {
    const line = lines[index]
    if (line?.kind !== 'context') {
      break
    }
    before.unshift(line.text)
  }
  const after: string[] = []
  for (
    let index = hunk.endIndex + 1;
    index < lines.length && after.length < ANCHOR_CONTEXT_ROWS;
    index += 1
  ) {
    const line = lines[index]
    if (line?.kind !== 'context') {
      break
    }
    after.push(line.text)
  }
  return { before, oldSide, newSide, after }
}

/** Where the hunk's new side starts in the file, 1-based, when the card's rows
 *  are numbered. A pure deletion has no added row to read it from, so it takes
 *  the row it sits between; with neither neighbour there is no position. */
export function numberedHunkPosition(file: NativeChatEditFile, hunk: MobileDiffHunk): number | null {
  if (!file.lineNumbersKnown) {
    return null
  }
  for (let index = hunk.startIndex; index <= hunk.endIndex; index += 1) {
    const line = file.lines[index]
    if (line?.kind === 'add' && line.newLineNumber !== null) {
      return line.newLineNumber
    }
  }
  const previous = file.lines[hunk.startIndex - 1]
  if (previous?.kind === 'context' && previous.newLineNumber !== null) {
    return previous.newLineNumber + 1
  }
  const next = file.lines[hunk.endIndex + 1]
  if (next?.kind === 'context' && next.newLineNumber !== null) {
    return next.newLineNumber
  }
  return null
}

type LineEndings = { eol: '\n' | '\r\n'; trailingNewline: boolean }

/** The file's own line ending, or null when it uses both — a rewrite would
 *  then normalise lines the user never asked to change. */
function detectLineEndings(content: string): LineEndings | null {
  let crlf = 0
  let lf = 0
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    lf += 1
    if (index > 0 && content[index - 1] === '\r') {
      crlf += 1
    }
  }
  if (crlf > 0 && crlf !== lf) {
    return null
  }
  return { eol: crlf > 0 ? '\r\n' : '\n', trailingNewline: content.endsWith('\n') }
}

/** Rows of the current file. Unlike the card's splitter this has no character
 *  cap: a clipped file written back would be a clipped file. */
function splitFileLines(content: string): string[] {
  if (content.length === 0) {
    return []
  }
  const lines = content.split(/\r?\n/)
  if (content.endsWith('\n')) {
    lines.pop()
  }
  return lines
}

function matchesAt(haystack: readonly string[], needle: readonly string[], start: number): boolean {
  if (start < 0 || start + needle.length > haystack.length) {
    return false
  }
  for (let index = 0; index < needle.length; index += 1) {
    if (haystack[start + index] !== needle[index]) {
      return false
    }
  }
  return true
}

function findAll(haystack: readonly string[], needle: readonly string[]): number[] {
  const found: number[] = []
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (matchesAt(haystack, needle, start)) {
      found.push(start)
    }
  }
  return found
}

/** What the card alone can rule out, before the file is read. The card uses
 *  this to withhold the action; the request uses it to refuse before any RPC. */
export function hunkRevertPrecheck(
  file: NativeChatEditFile,
  hunkIndex: number,
  /** The card's hunks, when the caller already has them (the card draws every
   *  hunk's action from one grouping; recomputing per hunk is quadratic). */
  hunks: readonly MobileDiffHunk[] = editCardHunks(file)
): { ok: true; hunk: MobileDiffHunk } | Extract<HunkRevertPlan, { ok: false }> {
  if (file.changeKind === 'added' || file.changeKind === 'deleted') {
    return refuse('whole-file-change')
  }
  const hunk = hunks[hunkIndex]
  if (!hunk) {
    return refuse('no-such-hunk')
  }
  // Whatever the change kind says, a card that is one added block and nothing
  // else — no removed row, no context — is a whole-content write. A Claude
  // `Write` over an existing file reads "updated", not "created", so it
  // arrives as an edit; the lines it replaced were never on the card, and a
  // revert of the one hunk would leave the file empty.
  if (
    hunk.deletedLines === 0 &&
    hunk.startIndex === 0 &&
    hunk.endIndex === file.lines.length - 1
  ) {
    return refuse('whole-file-change')
  }
  if (file.truncated && hunk.endIndex === file.lines.length - 1) {
    return refuse('hunk-cut-by-truncation')
  }
  return { ok: true, hunk }
}

/**
 * What `currentContent` becomes with hunk `hunkIndex` of `file` undone.
 *
 * The hunk's new side plus up to three context rows on each side must be found
 * in the file as it is NOW. With numbered rows it must be found at the number
 * the card states; a match anywhere else means lines moved under it, and that
 * is a change since, not a revert target. Without numbers (a snippet-pair
 * edit) it must be found exactly once — the same rule Claude's own Edit tool
 * holds its `old_string` to. A pure deletion, having no lines of its own to
 * find, is also refused when the removed lines already sit beside the anchor.
 */
export function planHunkRevert(
  file: NativeChatEditFile,
  hunkIndex: number,
  currentContent: string,
  /** Lines the phone's own earlier reverts on this card moved this hunk by;
   *  the card's number plus this is where the hunk is now. Never a guess:
   *  the caller knows it because it made those writes. */
  positionShift = 0
): HunkRevertPlan {
  const checked = hunkRevertPrecheck(file, hunkIndex)
  if (!checked.ok) {
    return checked
  }
  const { hunk } = checked
  const { before, oldSide, newSide, after } = hunkSides(file.lines, hunk)
  const needle = [...before, ...newSide, ...after]
  if (needle.length === 0) {
    return refuse('no-anchor')
  }
  const endings = detectLineEndings(currentContent)
  if (!endings) {
    return refuse('mixed-line-endings')
  }
  const current = splitFileLines(currentContent)
  const position = numberedHunkPosition(file, hunk)
  let start: number
  if (position !== null) {
    start = position + positionShift - 1 - before.length
    if (!matchesAt(current, needle, start)) {
      return refuse('drifted')
    }
  } else {
    const matches = findAll(current, needle)
    if (matches.length === 0) {
      return refuse('drifted')
    }
    if (matches.length > 1) {
      return refuse('ambiguous')
    }
    start = matches[0]!
  }
  const spliceAt = start + before.length
  // A pure deletion has no lines of its own in the file, so the anchor is all
  // there is — and on a side the card has no context for, it cannot tell
  // whether the deleted lines are already back. `a` still matches when the
  // file reads `a b c`; inserting `b c` after it would double them. This is
  // patch(1)'s already-applied check: on each unpinned side, refuse if the
  // removed lines sit right there. Anything else there is not our business.
  if (newSide.length === 0 && oldSide.length > 0) {
    const backBelow = after.length === 0 && matchesAt(current, oldSide, spliceAt)
    const backAbove =
      before.length === 0 && matchesAt(current, oldSide, spliceAt - oldSide.length)
    if (backBelow || backAbove) {
      return refuse('already-back')
    }
  }
  const next = [
    ...current.slice(0, spliceAt),
    ...oldSide,
    ...current.slice(spliceAt + newSide.length)
  ]
  const content =
    next.length === 0 ? '' : next.join(endings.eol) + (endings.trailingNewline ? endings.eol : '')
  return { ok: true, content, removed: newSide.length, restored: oldSide.length }
}
