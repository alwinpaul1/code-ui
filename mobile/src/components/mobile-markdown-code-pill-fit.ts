import type { CodePillCut } from './mobile-markdown-code-chip-split'

/**
 * Where each code span starts on its line, read back from the phone's own
 * layout of the Text it sits in.
 *
 * A pill's first piece has to be cut to the room left on the line the span
 * starts on (mobile-markdown-code-chip-split.ts), and only the text engine
 * knows where that line ends: the words before the span are in several
 * weights and sizes, beside other pills. So the Text reports its lines
 * (`onTextLayout`) and this reads them. The first layout draws each span cut
 * to a whole line; a pill that did not fit then starts a line of its own, and
 * the line above it says how much room it left. The next layout cuts the pill
 * to that room. It takes a few layouts to settle, one per span in the worst
 * case, because a span that fills its line moves the words after it.
 *
 * Android's lines (FontMetricsUtil.kt, RN 0.86): `text` holds U+FFFC for each
 * inline view, in document order; `width` is getLineWidth, the trailing
 * spaces included, except on a line ending in a newline. That the placeholder
 * is U+FFFC is AttributedString.cpp's AttachmentCharacter.
 */

export type PillLayoutLine = { x: number; width: number; text: string }

/** One span as it was drawn: the room its first piece was cut to. */
export type PillSpanDrawn = {
  code: string
  pieces: readonly string[]
  room: number
  fresh: boolean
}

/** The room a span's first piece is cut to. `below`: the width of a first
 *  piece that was drawn at this room and did not fit, because the phone drew
 *  it wider than estimated; the cut stays under it. */
export type PillFit = { room: number; below?: number }

export type TextPillFits = {
  fits: ReadonlyMap<number, PillFit>
  /** The width a continuation piece is cut to. */
  lineRoom: number
}

/** The room a span is cut with, given what the layout has taught it. */
export function pillFitRoom(fit: PillFit | undefined, lineRoom: number): number {
  if (!fit) {
    return lineRoom
  }
  return fit.below === undefined ? fit.room : Math.min(fit.room, fit.below)
}

const TOLERANCE = 1
const OBJECT_REPLACEMENT = '￼'

function lineEnd(line: PillLayoutLine): number {
  return line.x + line.width
}

/** Where each inline view landed: its line and its offset in the line. */
function placeholders(lines: readonly PillLayoutLine[]): { line: number; col: number }[] {
  const out: { line: number; col: number }[] = []
  lines.forEach((line, index) => {
    for (let col = line.text.indexOf(OBJECT_REPLACEMENT); col >= 0; col = line.text.indexOf(OBJECT_REPLACEMENT, col + 1)) {
      out.push({ line: index, col })
    }
  })
  return out
}

function sameCut(cut: CodePillCut, span: PillSpanDrawn): boolean {
  return (
    cut.fresh === span.fresh &&
    cut.pieces.length === span.pieces.length &&
    cut.pieces.every((piece, index) => piece === span.pieces[index])
  )
}

/**
 * The rooms the next layout should cut with, or null when this layout is
 * settled or cannot be read. A layout whose placeholders do not match the
 * pills drawn (a stale event, or U+FFFC typed in the prose) is not read at
 * all, and the pills stay as they were.
 */
export function readPillFits(args: {
  lines: readonly PillLayoutLine[]
  spans: readonly PillSpanDrawn[]
  /** The Text's own width, the one its lines were broken to. */
  lineWidth: number
  current: TextPillFits
  cut: (code: string, firstRoom: number, lineRoom: number) => CodePillCut
  width: (piece: string) => number
}): TextPillFits | null {
  const { lines, spans, lineWidth, current, cut, width } = args
  const at = placeholders(lines)
  const drawn = spans.reduce((sum, span) => sum + span.pieces.length, 0)
  if (at.length !== drawn || !(lineWidth > 0)) {
    return null
  }
  // A pill wider than its line hangs past the edge; later pieces are cut
  // narrower by as much. Estimates only ever err wide, save at a large system
  // font size, where Android also scales the placeholder. A line that ends in
  // a space is not read: Android lets trailing spaces hang past the edge, and
  // this width counts them.
  let lineRoom = current.lineRoom
  for (const line of lines) {
    const overflow = lineEnd(line) - lineWidth
    if (line.text.includes(OBJECT_REPLACEMENT) && !/[ \t]$/.test(line.text) && overflow > TOLERANCE) {
      lineRoom = Math.min(lineRoom, current.lineRoom - overflow - TOLERANCE)
    }
  }
  const fits = new Map<number, PillFit>()
  let changed = lineRoom !== current.lineRoom
  let first = 0
  spans.forEach((span, ordinal) => {
    const fit = current.fits.get(ordinal)
    if (fit) {
      fits.set(ordinal, fit)
    }
    const start = at[first]
    first += span.pieces.length
    if (!start) {
      return
    }
    let proposal: PillFit | undefined
    const above = lines[start.line - 1]
    if (start.col === 0 && above && !above.text.endsWith('\n')) {
      // It starts a line after a soft wrap: the line above says what it left.
      const room = lineWidth - lineEnd(above)
      // What failed at another room says nothing about this one.
      const known = fit !== undefined && Math.abs(fit.room - room) <= TOLERANCE ? fit.below : undefined
      if (!span.fresh) {
        // Cut to fit up there and it did not: the phone drew it wider.
        proposal = { room, below: Math.min(known ?? Infinity, width(span.pieces[0]!)) }
      } else if (room > span.room + TOLERANCE) {
        // It went down whole, and the line above has since made room.
        proposal = { room, below: known }
      }
    } else {
      // It starts mid-line or after a hard break. If a later piece wrapped,
      // the first line held what it drew plus what it left empty. If two
      // pieces share the line, it was cut for a room it no longer starts in
      // (a span before it was re-cut) and fits whole or further.
      let onLine = 1
      while (onLine < span.pieces.length && at[first - span.pieces.length + onLine]!.line === start.line) {
        onLine += 1
      }
      if (onLine < span.pieces.length || onLine > 1) {
        const used = span.pieces.slice(0, onLine).reduce((sum, piece) => sum + width(piece), 0)
        const room = Math.min(lineWidth, used + lineWidth - lineEnd(lines[start.line]!))
        if (room > span.room + TOLERANCE) {
          // A room that moved by more than a tenth of the line is a new place;
          // what failed at the old one says nothing here.
          const moved = fit !== undefined && room - fit.room > lineWidth / 10
          proposal = { room, below: moved ? undefined : fit?.below }
        }
      }
    }
    if (proposal && !sameCut(cut(span.code, pillFitRoom(proposal, lineRoom), lineRoom), span)) {
      fits.set(ordinal, proposal)
      changed = true
    }
  })
  return changed ? { fits, lineRoom } : null
}
