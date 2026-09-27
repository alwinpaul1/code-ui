/**
 * Cutting an inline code span into pills that flow with the prose.
 *
 * A pill is an inline View (the only way Android rounds a chip), and a View
 * cannot break across lines, so a span is cut into one pill per line it
 * crosses. The Claude app draws the same span as text that starts right after
 * the word before it and breaks where the line ends:
 * `/Users/alwinpaul/Desktop/Project/Code` on the "Worktree:" line and
 * `UI/.claude/worktrees/chat-rows` on the next (2026-09-26). Code UI cut the
 * span to a whole line's width wherever it started, so the first pill did not
 * fit beside "Worktree:" and jumped whole to the next line, leaving the line
 * above mostly empty.
 *
 * So the first piece is cut to the room left on the line the span starts on
 * (measured from the phone's own layout, mobile-markdown-code-pill-fit.ts) and
 * every later piece to a whole line. Cuts land where a reader would break the
 * token: after a slash or a space; inside a token only when it is longer than
 * a whole line, first after `-`, `_`, `.`, `=`, `:`, then anywhere, filling
 * the line. A token that fits a line but not the room left moves down whole,
 * like a word.
 */

import { INSTRUMENT_SANS_ASCII_ADVANCE, INSTRUMENT_SANS_OTHER_ADVANCE } from './instrument-sans-regular-advances'

/** A character the font does not have comes from a fallback font: CJK,
 *  Hangul, full-width forms and emoji at about a full em, the rest at 0.6. */
const WIDE_ADVANCE = 1000
const OTHER_ADVANCE = 600

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f000
  )
}

/** The painted width of code set in the pill's face, in dp, from the font's
 *  own advances (instrument-sans-regular-advances.ts). Kerning is left out;
 *  the phone's layout tells how much it matters (mobile-markdown-code-pill-fit.ts). */
export function codeTextWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    units +=
      code >= 0x20 && code <= 0x7e
        ? INSTRUMENT_SANS_ASCII_ADVANCE[code - 0x20]!
        : (INSTRUMENT_SANS_OTHER_ADVANCE[code] ?? (isWide(code) ? WIDE_ADVANCE : OTHER_ADVANCE))
  }
  return (units * fontSize) / 1000
}

export type CodePillFont = {
  fontSize: number
  /** Border and padding, both sides together. */
  insets: number
  /** How much wider than estimated the phone draws a pill's text, learnt
   *  from its own layout (mobile-markdown-code-pill-fit.ts); 1 until known.
   *  Padding and border are dp, and not scaled. */
  scale?: number
  /** The room a pill with a frame this wide takes on its line: at a system
   *  font size RN reserves more than the frame (PillMeasure.reserve). */
  reserve?: (frame: number) => number
}

/** What one pill takes on the line: its text, its padding and border, and
 *  at a system font size the room RN reserves for that. */
export function codePillWidth(text: string, font: CodePillFont): number {
  const frame = codeTextWidth(text, font.fontSize) * (font.scale ?? 1) + font.insets
  return font.reserve ? font.reserve(frame) : frame
}

/** A pill after words must clear the room left by this much: Android rounds
 *  an inline view up to the next pixel, and the measured width is rounded to
 *  the dp, and a pill a hair too wide goes down a line. One that starts a
 *  line has nowhere to go down to, so it takes the whole line: a pill as wide
 *  as its bubble, which is as wide as the pill rounded up, was cut in two by
 *  this slack, the two made the bubble wider, where it fitted whole again,
 *  and the bubble swung between the two widths (review of 12e3b98e, S3). */
const FIT_SLACK = 1
/** A span whose scale is still a guess, cut for a whole line, is tried whole
 *  if it would fit drawn this much narrower than estimated (kerning mostly
 *  narrows it): alone on its line the phone reads it back exactly, where cut
 *  in two it only says how the two pieces sit. A bubble as wide as the pill
 *  drawn 3% narrower did not fit the estimate, was cut in two, grew, and
 *  swung between two widths too. */
const GUESS_MARGIN = 0.05
/** A token cut inside puts at least this many characters at a line's end;
 *  fewer is a stub, and the token starts on the next line instead. */
const MIN_CUT_CHARS = 3

export type CodePillCut = {
  /** One per line the span crosses. A line-ending piece loses its trailing
   *  space, which the line would hang anyway. */
  pieces: string[]
  /** Nothing fit in the first room: the first piece starts a line of its own. */
  fresh: boolean
}

export function cutCodePills(
  code: string,
  firstRoom: number,
  lineRoom: number,
  font: CodePillFont,
  /** What is glued to the span's end and cannot break from it, as `path` is
   *  to the full stop in "`path`." A last piece that just fills its line
   *  with that on it runs past the edge. */
  glue = 0,
  /** The scale is a guess: nothing has been read of how the phone draws it. */
  guessed = false
): CodePillCut {
  if (
    guessed &&
    firstRoom >= lineRoom &&
    codePillWidth(code.trimEnd(), { ...font, scale: (font.scale ?? 1) * (1 - GUESS_MARGIN) }) + glue <= lineRoom
  ) {
    return { pieces: code ? [code] : [], fresh: false }
  }
  const pieces: string[] = []
  let fresh = false
  let line = ''
  let room = firstRoom
  // Everything up to `consumed` is placed; a candidate that reaches the end
  // of the code carries the glue.
  let consumed = 0
  const slack = (space: number) => (space >= lineRoom ? 0 : FIT_SLACK)
  const fits = (text: string, space: number) =>
    codePillWidth(text.trimEnd(), font) + (consumed + text.length - line.length === code.length ? glue : 0) <=
    space - slack(space)
  /** Whether `text` fits a line of its own; asked before the line wraps. */
  const fitsAlone = (text: string, space: number) =>
    codePillWidth(text.trimEnd(), font) + (consumed + text.length === code.length ? glue : 0) <= space - slack(space)
  const wrap = () => {
    if (line) {
      pieces.push(line)
    } else if (pieces.length === 0) {
      fresh = true
    }
    line = ''
    room = lineRoom
  }
  const place = (text: string) => {
    line += text
    consumed += text.length
  }
  for (const unit of splitAfter(code, /[/\s]/)) {
    if (fits(line + unit, room)) {
      place(unit)
      continue
    }
    if (fitsAlone(unit, lineRoom)) {
      wrap()
      place(unit)
      continue
    }
    // Longer than a whole line: break inside it, filling this line first.
    for (const part of splitAfter(unit, /[-_.=:]/)) {
      if (fits(line + part, room)) {
        place(part)
        continue
      }
      if (fitsAlone(part, lineRoom)) {
        wrap()
        place(part)
        continue
      }
      const chars = Array.from(part)
      if (!fits(line + chars.slice(0, MIN_CUT_CHARS).join(''), room)) {
        wrap()
      }
      for (const ch of chars) {
        // A lone character wider than the line still has to go somewhere.
        if (!line || fits(line + ch, room)) {
          place(ch)
          continue
        }
        wrap()
        place(ch)
      }
    }
  }
  if (line) {
    pieces.push(line)
  }
  return {
    pieces: pieces
      .map((piece, index) => (index < pieces.length - 1 ? piece.trimEnd() : piece))
      .filter((piece) => piece.length > 0),
    fresh
  }
}

/** Pieces that end right after a boundary character, keeping it. */
function splitAfter(text: string, boundary: RegExp): string[] {
  const out: string[] = []
  let start = 0
  const chars = Array.from(text)
  let offset = 0
  for (let i = 0; i < chars.length; i++) {
    offset += chars[i]!.length
    if (boundary.test(chars[i]!) && i + 1 < chars.length) {
      out.push(text.slice(start, offset))
      start = offset
    }
  }
  out.push(text.slice(start))
  return out.filter((piece) => piece.length > 0)
}
