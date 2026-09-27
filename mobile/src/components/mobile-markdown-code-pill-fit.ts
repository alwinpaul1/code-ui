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

/** The scale a span's text is cut with: its own reading, or else the
 *  Text's (textPillScale). */
export function pillFitScale(fit: PillFit | undefined, textScale = 1): number {
  return fit?.scale ?? textScale
}

/**
 * The scale for a span that has no reading of its own: the most any span in
 * the Text has read. The system font size scales every pill alike (Android
 * scales an inline view's room by it: toPixelFromSP), so a short span that
 * has never been alone on a line is cut as the long one beside it reads; with
 * every advance read from the font, what differs between spans is kerning,
 * which only makes this cut a little short. 1 until anything is read.
 */
export function textPillScale(fits: ReadonlyMap<number, PillFit>): number {
  let most: number | undefined
  for (const fit of fits.values()) {
    if (fit.floor !== undefined) {
      most = Math.max(most ?? fit.floor, fit.floor)
    }
  }
  return most ?? 1
}

const TOLERANCE = 1
const OBJECT_REPLACEMENT = '\uFFFC'
/** The most a trailing space can add to a line's reported width: Android
 *  counts hanging spaces, a 22 dp heading's space at the largest zoom is 8. */
const HANGING_SPACE = 8
/** One unbreakable word holding a single pill, the only thing that can run
 *  past its line: a pill wider than the whole line. */
const LONE_WORD = /^[^\s\uFFFC]*\uFFFC[^\s\uFFFC]*$/
const SCALE_LIMITS = [0.5, 2] as const
/** How far past the room a first piece measured roughly (the line less the
 *  words after it) must reach before it counts as drawn wider. */
const SOFT_MARGIN = 0.02

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

/**
 * How wide a span's first piece was drawn, with what is glued to it, on a
 * line it starts: exactly, when the line holds that word alone; roughly, when
 * only plain words follow it (the line less those words at the prose size);
 * not at all when another pill shares the line.
 */
function firstPieceDrawn(line: PillLayoutLine, proseSize: number): { width: number; exact: boolean } | undefined {
  const text = line.text.endsWith('\n') ? line.text.trimEnd() : line.text
  if (text.indexOf(OBJECT_REPLACEMENT) !== 0 || text.includes(OBJECT_REPLACEMENT, 1)) {
    return undefined
  }
  const word = /^\uFFFC[^\s]*/.exec(text)![0]
  const after = text.slice(word.length)
  return { width: lineEnd(line) - codeTextWidth(after, proseSize), exact: after.trim() === '' }
}

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
 * drawn; one that holds a piece and the punctuation glued to it (`\uFFFC.`)
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
  proseSize: number,
  /** The Text's scale, which a span with none of its own is cut with. */
  textScale: number
): { scale: number | undefined; floor: number | undefined } {
  const current = pillFitScale(fit, textScale)
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
  // No reading and none before: the span follows the Text's scale.
  let scale = fit?.scale === undefined ? read : Math.max(fit.scale, read ?? fit.scale)
  if (read === undefined && floor === undefined) {
    // No lone piece yet: the span's first piece, last on a line of plain
    // words, was drawn as wide as the line less those words at the prose
    // size. Only a narrower reading is taken, and it sets no floor: a word
    // set bolder or larger than priced only makes the pill look wider.
    const first = owners[0]
    const line = first ? lines[first.line]! : undefined
    const text = first ? measure.textWidth(first.text) : 0
    if (line && text > 0 && line.text.split(OBJECT_REPLACEMENT).length === 2 && /\uFFFC[^\s\uFFFC]*\s*$/.test(line.text)) {
      const beside = line.text.endsWith('\n') ? line.text.trimEnd() : line.text
      const soft = (lineEnd(line) - codeTextWidth(beside.replace(OBJECT_REPLACEMENT, ''), proseSize) - measure.insets) / text
      if (soft < (scale ?? textScale)) {
        scale = soft
      }
    }
  }
  if (caps.length > 0) {
    scale = Math.min(scale ?? textScale, ...caps)
  }
  if (scale === undefined) {
    return { scale, floor }
  }
  scale = Math.max(scale, floor ?? 0)
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
  /** `guessed`: the span has read nothing of its own scale
   *  (mobile-markdown-code-chip-split.ts). */
  cut: (code: string, firstRoom: number, scale: number, glue: number, guessed: boolean) => CodePillCut
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
  let stale = false
  // Each span's pieces, and what its own lines read of its scale; then the
  // Text's scale from all of them, for the spans with none.
  const heldTextScale = textPillScale(current.fits)
  let offset = 0
  const learnt = spans.map((span, ordinal) => {
    const owners: Owner[] = span.pieces.map((text, piece) => ({ ...at[offset + piece]!, span: ordinal, piece, text }))
    offset += span.pieces.length
    const held = current.fits.get(ordinal)
    return { owners, held, ...learnScale(lines, owners, measure, held, lineWidth, proseSize, heldTextScale) }
  })
  const textScale = textPillScale(new Map(learnt.map(({ floor }, ordinal) => [ordinal, { floor }])))
  spans.forEach((span, ordinal) => {
    const { owners, held, floor } = learnt[ordinal]!
    const scale = learnt[ordinal]!.scale ?? textScale
    // What failed at another scale says nothing at this one.
    const rescaled = Math.abs(scale - pillFitScale(held, heldTextScale)) > 0.005
    const fit: PillFit = { room: held?.room, below: rescaled ? undefined : held?.below, scale: learnt[ordinal]!.scale, floor }
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
      const drawnFirst = firstPieceDrawn(lines[start.line]!, proseSize)
      if (drawnFirst?.exact && drawnFirst.width <= room - TOLERANCE) {
        // It went down a line with room for it above: greedy breaking never
        // does that, so these lines were broken to another, narrower width.
        stale = true
        return
      }
      // Roughly: the words after it are priced in the prose face, within a
      // couple of per cent of the phone's.
      const proven =
        drawnFirst !== undefined && drawnFirst.width > room + (drawnFirst.exact ? 0 : Math.max(3, room * SOFT_MARGIN))
      if (!span.fresh && proven && sameCut(cut(span.code, pillFitRoom({ room, below: fit.below }, lineWidth), scale, span.glue, floor === undefined), span)) {
        // Cut as it would be for this very room, and drawn, by its own line,
        // wider than the room: the phone draws it wider than estimated. Only
        // a line can prove that. "Cut for this room and went down" alone
        // cannot tell a pill drawn wide from a layout broken narrower, which
        // capped a first piece one unit short at 800 dp after 800 -> 600 ->
        // 800, and kept it (review of 3dd68229).
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
  if (stale) {
    return { kind: 'unreadable' }
  }
  const firstChanged = spans.findIndex((span, ordinal) => {
    const fit = fits.get(ordinal)
    return !sameCut(
      cut(span.code, pillFitRoom(fit, lineWidth), pillFitScale(fit, textScale), span.glue, fit?.floor === undefined),
      span
    )
  })
  return firstChanged === -1 ? { kind: 'settled' } : { kind: 'changed', next: { fits }, firstChanged }
}
