import { codeTextWidth, type CodePillCut } from './mobile-markdown-code-chip-split'

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
 * is U+FFFC is AttributedString.cpp's AttachmentCharacter. Every U+FFFC in a
 * run is a pill: a figure the phone can draw is a block of its own
 * (buildProseRuns), never an inline view in a run.
 */

export type PillLayoutLine = { x: number; width: number; text: string }

/** One span as it was drawn: the room its first piece was cut to. */
export type PillSpanDrawn = {
  code: string
  pieces: readonly string[]
  room: number
  fresh: boolean
  /** The width of what is glued to its end ("`path`."), cut with it. */
  glue: number
}

/**
 * What the layout has taught one span.
 * - `room`: the room its first piece is cut to.
 * - `below`: the width of a first piece that was cut for exactly this room
 *   and still went down a line, because the phone drew it wider; the cut
 *   stays under it.
 * - `scale`: how much wider than estimated the phone draws this span's text
 *   (the system font size, kerning, a fallback font), and `floor`, the most
 *   it has been seen to be: it never falls below that.
 */
export type PillFit = { room?: number; below?: number; scale?: number; floor?: number }

export type TextPillFits = { fits: ReadonlyMap<number, PillFit> }

export type PillFitRead =
  /** Lines that cannot be this Text's at this width, or pills that are not
   *  the ones drawn: nothing is learnt from them. */
  | { kind: 'unreadable' }
  /** Every pill fills what it should: what was drawn is the answer. */
  | { kind: 'settled' }
  /** Re-cut. Spans before `firstChanged` keep their cut, so their pills stay
   *  mounted; a re-cut moves only what comes after it. */
  | { kind: 'changed'; next: TextPillFits; firstChanged: number }

/** A pill's width as the cutter estimates it, before the phone's scale. */
export type PillMeasure = {
  /** The text's width in the pill's face. */
  textWidth: (piece: string) => number
  /** Padding and border, both sides: dp, which no font size scales. */
  insets: number
}

/** The room a span's first piece is cut with, given what the layout taught it. */
export function pillFitRoom(fit: PillFit | undefined, lineRoom: number): number {
  const room = fit?.room ?? lineRoom
  return fit?.below === undefined ? room : Math.min(room, fit.below)
}

/** The scale a span's text is cut with. */
export function pillFitScale(fit: PillFit | undefined): number {
  return fit?.scale ?? 1
}

const TOLERANCE = 1
const OBJECT_REPLACEMENT = '￼'
/** The most a trailing space can add to a line's reported width: Android
 *  counts hanging spaces, a 22 dp heading's space at the largest zoom is 8. */
const HANGING_SPACE = 8
/** One unbreakable word holding a single pill, the only thing that can run
 *  past its line: a pill wider than the whole line. */
const LONE_WORD = /^[^\s￼]*￼[^\s￼]*$/
const SCALE_LIMITS = [0.5, 2] as const

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

/**
 * Whether these lines were broken to this width. On a rotation, split screen
 * or pop-up view, Fabric lays the tree out at the new width and reports its
 * lines before the document's onLayout brings that width to a render, so the
 * handler still holds the old one. Wider lines read at the old width made
 * every pill look like it overflowed (2026-09-27 review of 216a856f);
 * narrower ones made a pill with room look like it had gone down a line
 * anyway, and its first piece was capped, one unit more on every turn (review
 * of f8c968a1). Two proofs, both only of what greedy breaking cannot do:
 * words running past the width (only a lone pill wider than its line can),
 * and a line that would have fitted whole after the line above it.
 */
function brokenTo(lines: readonly PillLayoutLine[], lineWidth: number): boolean {
  return lines.every((line, index) => {
    const hanging = /[ \t]*$/.exec(line.text)![0].length
    const ink = lineEnd(line) - hanging * HANGING_SPACE
    if (ink > lineWidth + TOLERANCE && !LONE_WORD.test(line.text.trimEnd())) {
      return false
    }
    const above = lines[index - 1]
    return !(above && !above.text.endsWith('\n') && lineEnd(above) + lineEnd(line) <= lineWidth - TOLERANCE)
  })
}

/** A placeholder, and the pill it stands for. */
type Owner = { line: number; col: number; span: number; piece: number; text: string }

function sameCut(cut: CodePillCut, span: PillSpanDrawn): boolean {
  return (
    cut.fresh === span.fresh &&
    cut.pieces.length === span.pieces.length &&
    cut.pieces.every((piece, index) => piece === span.pieces[index])
  )
}

/**
 * A span's scale, from the current layout and what it has seen before. A line
 * that holds one of its pieces and nothing else reports that piece's width as
 * drawn; one that holds a piece and the punctuation glued to it (`￼.`)
 * does, less that punctuation and any hanging space at the prose size. Such a
 * line that still runs past its edge was cut to fit at the current scale, so
 * the scale rises by at least that much. The first reading sets it; after
 * that it only rises, and never falls below the most it has read (`floor`),
 * save for two of its pieces side by side on a line, which fitted there
 * together and cap it (2026-09-27 review, probe C2). One scale per Text, set
 * by whichever lone pill read widest, swung between two cuts forever: a pill
 * of arrows the estimate underpriced set it for the path beside it (review of
 * f8c968a1, probe F2).
 */
function learnScale(
  lines: readonly PillLayoutLine[],
  owners: readonly Owner[],
  measure: PillMeasure,
  fit: PillFit | undefined,
  lineWidth: number,
  proseSize: number
): { scale: number; floor: number | undefined } {
  const current = pillFitScale(fit)
  const ratios: number[] = []
  const caps: number[] = []
  owners.forEach((owner, index) => {
    const line = lines[owner.line]!
    const text = measure.textWidth(owner.text)
    if (LONE_WORD.test(line.text.trimEnd()) && text > 0) {
      // A line that ends in a newline reports its width without its trailing
      // spaces; a soft-wrapped one counts them.
      const beside = line.text.endsWith('\n') ? line.text.trimEnd() : line.text
      const drawn = lineEnd(line) - codeTextWidth(beside.replace(OBJECT_REPLACEMENT, ''), proseSize)
      ratios.push((drawn - measure.insets) / text)
      if (drawn > lineWidth + TOLERANCE) {
        ratios.push((current * (drawn - measure.insets)) / (lineWidth - TOLERANCE - measure.insets))
      }
    }
    // A run of this span's continuation pieces, side by side.
    const next = owners[index + 1]
    const previous = owners[index - 1]
    const startsRun =
      owner.piece >= 1 && next?.line === owner.line && !(previous?.line === owner.line && previous.piece >= 1)
    if (startsRun) {
      let texts = 0
      let insets = 0
      for (let at = index; owners[at]?.line === owner.line; at += 1) {
        texts += measure.textWidth(owners[at]!.text)
        insets += measure.insets
      }
      caps.push((lineEnd(line) - insets) / texts)
    }
  })
  const read = ratios.length > 0 ? Math.max(...ratios) : undefined
  const floor = read === undefined ? fit?.floor : Math.max(fit?.floor ?? read, read)
  let scale = fit?.scale === undefined ? (read ?? 1) : Math.max(current, read ?? current)
  if (read === undefined && floor === undefined) {
    // No lone piece yet: the span's first piece, last on a line of plain
    // words, was drawn as wide as the line less those words at the prose
    // size. Only a narrower reading is taken, and it sets no floor: a word
    // set bolder or larger than priced only makes the pill look wider.
    const first = owners[0]
    const line = first ? lines[first.line]! : undefined
    const text = first ? measure.textWidth(first.text) : 0
    if (line && text > 0 && line.text.split(OBJECT_REPLACEMENT).length === 2 && /￼[^\s￼]*\s*$/.test(line.text)) {
      const beside = line.text.endsWith('\n') ? line.text.trimEnd() : line.text
      const soft = (lineEnd(line) - codeTextWidth(beside.replace(OBJECT_REPLACEMENT, ''), proseSize) - measure.insets) / text
      scale = Math.min(scale, soft)
    }
  }
  scale = Math.max(Math.min(scale, ...caps), floor ?? 0)
  return { scale: Math.min(SCALE_LIMITS[1], Math.max(SCALE_LIMITS[0], scale)), floor }
}

/**
 * What the next layout should cut with. A layout whose placeholders do not
 * match the pills drawn (a stale event, or U+FFFC typed in the prose), or
 * whose lines were broken to another width, is not read at all.
 */
export function readPillFits(args: {
  lines: readonly PillLayoutLine[]
  spans: readonly PillSpanDrawn[]
  /** The Text's own width, the one its lines should be broken to. */
  lineWidth: number
  current: TextPillFits
  cut: (code: string, firstRoom: number, scale: number, glue: number) => CodePillCut
  measure: PillMeasure
  /** The Text's own type size, for the punctuation beside a pill. */
  proseSize: number
}): PillFitRead {
  const { lines, spans, lineWidth, current, cut, measure, proseSize } = args
  const at = placeholders(lines)
  const drawn = spans.reduce((sum, span) => sum + span.pieces.length, 0)
  if (at.length !== drawn || !(lineWidth > 0) || !brokenTo(lines, lineWidth)) {
    return { kind: 'unreadable' }
  }
  const fits = new Map<number, PillFit>()
  let first = 0
  spans.forEach((span, ordinal) => {
    const owners: Owner[] = span.pieces.map((text, piece) => ({ ...at[first + piece]!, span: ordinal, piece, text }))
    first += span.pieces.length
    const held = current.fits.get(ordinal)
    const { scale, floor } = learnScale(lines, owners, measure, held, lineWidth, proseSize)
    // What failed at another scale says nothing at this one.
    const rescaled = Math.abs(scale - pillFitScale(held)) > 0.005
    const fit: PillFit = { room: held?.room, below: rescaled ? undefined : held?.below, scale, floor }
    fits.set(ordinal, fit)
    const start = owners[0]
    if (!start) {
      return
    }
    const scaled = (piece: string) => measure.textWidth(piece) * scale + measure.insets
    const above = lines[start.line - 1]
    if (start.col === 0 && above && !above.text.endsWith('\n')) {
      // It starts a line after a soft wrap: the line above says what it left.
      const room = lineWidth - lineEnd(above)
      const sameRoom = fit.room !== undefined && Math.abs(fit.room - room) <= TOLERANCE
      if (!span.fresh && sameCut(cut(span.code, pillFitRoom({ room, below: fit.below }, lineWidth), scale, span.glue), span)) {
        // Cut as it would be for this very room, and it went down: the phone
        // drew it wider. (Cut for a whole line and landing in a narrower
        // room proves nothing about the narrower one: review of f8c968a1.)
        fit.below = Math.min(sameRoom ? (fit.below ?? Infinity) : Infinity, scaled(span.pieces[0]!))
        fit.room = room
      } else if (!span.fresh || room > span.room + TOLERANCE) {
        // Cut for another room (a whole line, or one the span no longer
        // starts in): now it knows its room, and nothing has failed in it.
        fit.below = sameRoom ? fit.below : undefined
        fit.room = room
      }
      return
    }
    // It sat on the line it starts on, so a first piece as wide as it was
    // drawn fits: a cap under that is wrong.
    let onLine = 1
    while (onLine < owners.length && owners[onLine]!.line === start.line) {
      onLine += 1
    }
    const used = owners.slice(0, onLine).reduce((sum, owner) => sum + scaled(owner.text), 0)
    if (fit.below !== undefined && fit.below <= used + TOLERANCE) {
      fit.below = undefined
    }
    // If a later piece wrapped, the first line held what it drew plus what it
    // left empty. If two pieces share the line, it was cut for a room it no
    // longer starts in (a span before it was re-cut) and fits whole or further.
    if (onLine < owners.length || onLine > 1) {
      const room = Math.min(lineWidth, used + lineWidth - lineEnd(lines[start.line]!))
      if (room > span.room + TOLERANCE) {
        fit.room = room
      }
    }
  })
  const firstChanged = spans.findIndex((span, ordinal) => {
    const fit = fits.get(ordinal)
    return !sameCut(cut(span.code, pillFitRoom(fit, lineWidth), pillFitScale(fit), span.glue), span)
  })
  return firstChanged === -1 ? { kind: 'settled' } : { kind: 'changed', next: { fits }, firstChanged }
}
