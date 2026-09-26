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
 * is U+FFFC is AttributedString.cpp's AttachmentCharacter.
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

/** The room a span's first piece is cut to. `below`: the width of a first
 *  piece that was drawn at this room and did not fit, because the phone drew
 *  it wider than estimated; the cut stays under it. */
export type PillFit = { room: number; below?: number }

export type TextPillFits = {
  fits: ReadonlyMap<number, PillFit>
  /** How much wider than estimated the phone draws a pill (the system font
   *  size, kerning, a fallback font), read from the layout itself. */
  scale: number
}

export type PillFitRead =
  /** Lines that cannot be this Text's at this width, or pills that are not
   *  the ones drawn: nothing is learnt from them. */
  | { kind: 'unreadable' }
  /** Every pill fills what it should: what was drawn is the answer. */
  | { kind: 'settled' }
  /** Re-cut. Spans before `firstChanged` keep their cut, so their pills stay
   *  mounted; a re-cut moves only what comes after it. */
  | { kind: 'changed'; next: TextPillFits; firstChanged: number }

/** The room a span is cut with, given what the layout has taught it. */
export function pillFitRoom(fit: PillFit | undefined, lineRoom: number): number {
  if (!fit) {
    return lineRoom
  }
  return fit.below === undefined ? fit.room : Math.min(fit.room, fit.below)
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
/** How much narrower every lone pill must read before the scale comes down. */
const SCALE_HYSTERESIS = 0.02

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
 * handler still holds the old one (2026-09-27 review: read at 360, the 700 dp
 * lines made every pill look like it overflowed, and the pills were chopped
 * for the rest of the session). A line whose words run past the width cannot
 * be this Text's; only a lone pill wider than its line can.
 */
function brokenTo(lines: readonly PillLayoutLine[], lineWidth: number): boolean {
  return lines.every((line) => {
    const hanging = /[ \t]*$/.exec(line.text)![0].length
    const ink = lineEnd(line) - hanging * HANGING_SPACE
    return ink <= lineWidth + TOLERANCE || LONE_WORD.test(line.text.trimEnd())
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

/** A pill's width as the cutter estimates it, before the phone's scale. */
export type PillMeasure = {
  /** The text's width in the pill's face. */
  textWidth: (piece: string) => number
  /** Padding and border, both sides: dp, which no font size scales. */
  insets: number
}

/**
 * The phone's scale for a pill's text in this Text, from the current layout.
 * A line that holds one pill and nothing else reports that pill's width as
 * drawn; one that holds a pill and the punctuation glued to it (`\uFFFC.`) does,
 * less that punctuation and any hanging space at the prose size. Such a line
 * that still runs past its edge was cut to fit at the current scale, so the
 * scale rises by at least that much. It falls only on plain evidence: every
 * lone pill drawn clearly narrower, or two pieces of one span side by side on
 * a line (2026-09-27 review, probe C2: "\uFFFC\uFFFC " shared a line), which caps it.
 * Different layouts show different pills, and a scale that followed each one
 * swung between two cuts forever.
 */
function learnScale(
  lines: readonly PillLayoutLine[],
  owners: readonly Owner[],
  measure: PillMeasure,
  current: number,
  lineWidth: number,
  proseSize: number
): number {
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
    // A run of continuation pieces of one span, side by side.
    const next = owners[index + 1]
    const previous = owners[index - 1]
    const startsRun =
      owner.piece >= 1 &&
      next?.span === owner.span &&
      next.line === owner.line &&
      !(previous?.span === owner.span && previous.line === owner.line)
    if (startsRun) {
      let texts = 0
      let insets = 0
      for (let at = index; owners[at]?.span === owner.span && owners[at]!.line === owner.line; at += 1) {
        texts += measure.textWidth(owners[at]!.text)
        insets += measure.insets
      }
      caps.push((lineEnd(line) - insets) / texts)
    }
  })
  let scale = current
  if (ratios.length > 0) {
    const measured = Math.max(...ratios)
    if (measured > current || measured < current * (1 - SCALE_HYSTERESIS)) {
      scale = measured
    }
  }
  scale = Math.min(scale, ...caps)
  return Math.min(SCALE_LIMITS[1], Math.max(SCALE_LIMITS[0], scale))
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
  // Which span and piece each placeholder is, in document order.
  const owners: Owner[] = []
  spans.forEach((span, ordinal) => {
    span.pieces.forEach((text, piece) => owners.push({ ...at[owners.length]!, span: ordinal, piece, text }))
  })
  const scale = learnScale(lines, owners, measure, current.scale, lineWidth, proseSize)
  // What failed at another scale says nothing at this one.
  const rescaled = Math.abs(scale - current.scale) > 0.005
  const scaled = (piece: string) => measure.textWidth(piece) * scale + measure.insets
  const fits = new Map<number, PillFit>()
  let first = 0
  spans.forEach((span, ordinal) => {
    const held = current.fits.get(ordinal)
    const fit = held && rescaled ? { room: held.room } : held
    if (fit) {
      fits.set(ordinal, fit)
    }
    const start = at[first]
    first += span.pieces.length
    if (!start) {
      return
    }
    const above = lines[start.line - 1]
    if (start.col === 0 && above && !above.text.endsWith('\n')) {
      // It starts a line after a soft wrap: the line above says what it left.
      const room = lineWidth - lineEnd(above)
      // What failed at another room says nothing about this one.
      const known = fit !== undefined && Math.abs(fit.room - room) <= TOLERANCE ? fit.below : undefined
      if (!span.fresh) {
        // Cut to fit up there and it did not: the phone drew it wider.
        fits.set(ordinal, { room, below: Math.min(known ?? Infinity, scaled(span.pieces[0]!)) })
      } else if (room > span.room + TOLERANCE) {
        // It went down whole, and the line above has since made room.
        fits.set(ordinal, { room, below: known })
      }
      return
    }
    // It starts mid-line or after a hard break. If a later piece wrapped,
    // the first line held what it drew plus what it left empty. If two
    // pieces share the line, it was cut for a room it no longer starts in
    // (a span before it was re-cut) and fits whole or further.
    let onLine = 1
    while (onLine < span.pieces.length && at[first - span.pieces.length + onLine]!.line === start.line) {
      onLine += 1
    }
    if (onLine < span.pieces.length || onLine > 1) {
      const used = span.pieces.slice(0, onLine).reduce((sum, piece) => sum + scaled(piece), 0)
      const room = Math.min(lineWidth, used + lineWidth - lineEnd(lines[start.line]!))
      if (room > span.room + TOLERANCE) {
        // A room that moved by more than a tenth of the line is a new place;
        // what failed at the old one says nothing here.
        const moved = fit !== undefined && room - fit.room > lineWidth / 10
        fits.set(ordinal, { room, below: moved ? undefined : fit?.below })
      }
    }
  })
  const firstChanged = spans.findIndex(
    (span, ordinal) => !sameCut(cut(span.code, pillFitRoom(fits.get(ordinal), lineWidth), scale, span.glue), span)
  )
  return firstChanged === -1 ? { kind: 'settled' } : { kind: 'changed', next: { fits, scale }, firstChanged }
}
