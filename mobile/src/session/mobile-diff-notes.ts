import type { MobileDiffLine, MobileDiffLineNote, MobileLineEndings } from './mobile-diff-lines'

/**
 * Rows of the mobile diff preview that stand for something other than a line of the file: a run of
 * unchanged lines folded away, the rows the mobile cap left out, git's "\ No newline at end of
 * file", or line endings that changed. They are `context` rows with no line numbers (so nothing
 * anchors a review note on them, and a hunk ends before them, save the no-newline row, which
 * belongs to its change), and their text says what they stand for, so a renderer that knows
 * nothing of `note` still reads right.
 */

/** 2896 → "2,896", the same on every phone (no locale: `toLocaleString(undefined)` follows the
 *  device, and "2.896" reads as a decimal in English). */
export function formatDiffCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function plural(count: number, one: string, many: string): string {
  return `${formatDiffCount(count)} ${count === 1 ? one : many}`
}

export function collapsedDiffRow(hiddenLines: number): MobileDiffLine {
  return {
    kind: 'context',
    text: plural(hiddenLines, 'unchanged line', 'unchanged lines'),
    note: { kind: 'collapsed', hiddenLines }
  }
}

/** What the cap left out, changed rows first: that is what a reviewer must not miss. */
function describeLeftOut(hiddenAdded: number, hiddenDeleted: number): string | null {
  const parts = [
    hiddenDeleted > 0 ? `${formatDiffCount(hiddenDeleted)} deleted` : null,
    hiddenAdded > 0 ? `${formatDiffCount(hiddenAdded)} added` : null
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) {
    return null
  }
  return `${parts.join(' and ')} ${hiddenAdded + hiddenDeleted === 1 ? 'line' : 'lines'}`
}

export function truncatedDiffRow(hiddenAdded: number, hiddenDeleted: number): MobileDiffLine {
  const leftOut = describeLeftOut(hiddenAdded, hiddenDeleted)
  return {
    kind: 'context',
    text: leftOut
      ? `... ${leftOut} not shown on mobile ...`
      : '... diff truncated for mobile preview ...',
    note: { kind: 'truncated', hiddenAdded, hiddenDeleted }
  }
}

export function noNewlineDiffRow(): MobileDiffLine {
  return { kind: 'context', text: '\\ No newline at end of file', note: { kind: 'no-newline' } }
}

const ENDINGS_LABEL: Record<MobileLineEndings, string> = {
  crlf: 'CRLF',
  lf: 'LF',
  mixed: 'mixed',
  none: 'none'
}

/** Lines are compared without their CR, so a change of line endings alone draws no changed row:
 *  this row is how the preview says it. The direction is named only when both sides have one. */
export function lineEndingsDiffRow(
  from: MobileLineEndings,
  to: MobileLineEndings,
  only: boolean
): MobileDiffLine {
  const direction =
    from !== to && from !== 'none' && to !== 'none'
      ? ` (${ENDINGS_LABEL[from]} → ${ENDINGS_LABEL[to]})`
      : ''
  return {
    kind: 'context',
    text: `${only ? 'Only line endings changed' : 'Line endings changed too'}${direction}`,
    note: { kind: 'line-endings', from, to, only }
  }
}

/** The footer under a truncated preview, naming what it left out when the rows say. */
export function describeMobileDiffTruncation(lines: readonly MobileDiffLine[]): string {
  const note: MobileDiffLineNote | undefined = lines[lines.length - 1]?.note
  const leftOut =
    note?.kind === 'truncated' ? describeLeftOut(note.hiddenAdded, note.hiddenDeleted) : null
  return leftOut
    ? `Diff truncated for mobile preview: ${leftOut} not shown.`
    : 'Diff truncated for mobile preview.'
}
