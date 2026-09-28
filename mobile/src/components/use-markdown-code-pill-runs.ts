import { useRef, useState } from 'react'
import { androidSpScale } from './android-font-scale'
import { codeTextWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
import {
  pillFitRoom,
  pillFitScale,
  readPillFits,
  textPillScale,
  type PillFit,
  type PillLayoutLine,
  type PillSpanDrawn,
  type TextPillFits
} from './mobile-markdown-code-pill-fit'
import { androidApiLevel, systemFontScale } from './system-font-scale'
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_CHIP_TEXT_RATIO,
  MARKDOWN_TABLE_CELL_FONT_SIZE,
  markdownChipScale,
  type MarkdownChipScale
} from './mobile-markdown-prose-scale'

/** The line a span is cut to before the document has been measured. */
const UNMEASURED_LINE_ROOM = 280
/** Settled cuts kept for Texts that scroll away and back (or come back in a
 *  recycled list cell), so they do not settle all over again. */
const REMEMBERED_TEXTS = 300
/** What may follow a span with no break before it, so it is cut with the
 *  span's end: closing punctuation, quotes, a slash, and a hyphen (after
 *  which a line may break). A letter may break from the span (U+FFFC is
 *  class CB), so "`foo`-based" glues the hyphen and not "based". */
const GLUE = /^[.,;:!?)\]}'"’”…/-]*/

type Entry = TextPillFits & {
  fontScale: number
  /** The message these were learnt on, when the caller names it, and its
   *  text. A reply streaming in keeps them as it grows; another message
   *  drawn in the same list cell does not. */
  identity: string | undefined
  document: string
  /** Each span's pill version, in its key: bumped for a span when it or a
   *  span before it is re-cut, so only pills that move are remounted. */
  versions: readonly number[]
  epoch: number
  /** Layouts read for this document on this visit to the width; a cap
   *  against a Text that never settles (each round re-lays the whole Text). */
  rounds: number
  /** Which visit to the width the rounds were counted on. Counted for as
   *  long as the document lasted, every turn back spent some of the cap, and
   *  by the third return to a width the re-cut that would have filled a line
   *  was refused (review of 12e3b98e, probe R4-W13x). */
  visit: number
}

const remembered = new Map<string, Entry>()

/** How many Texts have a settled cut remembered. */
export function rememberedPillTextCount(): number {
  return remembered.size
}

/** For tests only: forget every remembered cut, so one test's cuts cannot
 *  reach the next. */
export function resetRememberedPillCutsForTests(): void {
  remembered.clear()
}

const NO_FITS: ReadonlyMap<number, PillFit> = new Map()

export type CodePillTextLayout = { nativeEvent: { lines: readonly PillLayoutLine[] } }

/** The pills of one Text: how to cut each span, and the Text's layout reader. */
export type CodePillRun = {
  table: boolean
  chipScale: MarkdownChipScale | null
  /** Tells the run the source of an inline stretch it draws, so it knows
   *  whether a code span may be in it (a backtick) before one closes. */
  noteSource: (source: string) => void
  /** The pieces of the next span in this Text, in document order, and the
   *  version its pills are keyed by. `after`: the text that follows it.
   *  `size`: the type size of the words around it, in sp at the zoom (a
   *  heading's, in a run of prose); the Text's own when left out. */
  cut: (code: string, after: string, size?: number) => { pieces: string[]; version: number }
  /** Whether this Text may hold a pill, asked once its children are drawn:
   *  it has a backtick. Decided that early so a streaming paragraph does not
   *  change how it breaks its lines when its first span closes. */
  mayHoldPills: () => boolean
  /** The Text's React key, asked once its children are drawn. It carries
   *  the width when the width has changed since the Text was first measured:
   *  a Text laid out at a new width is a new Text, which always reports its
   *  lines, where the same tree at a new width may report nothing to a
   *  handler that could read it (2026-09-27 review of f8c968a1, probe B1). */
  keyFor: (base: string | number) => string
  /** For the Text's `onTextLayout`, asked once its children are drawn:
   *  nothing when it holds no pill or its width is not known yet. */
  layoutReader: () => ((event: CodePillTextLayout) => void) | undefined
}

/** A short key for the document, so remembered cuts are only reused for the
 *  exact text they were learnt on. */
export function markdownDocumentKey(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

/** Whether the document now drawn is the one an entry was learnt on, or the
 *  same one grown: text that starts with the old, under the same name when
 *  the caller names it. Both, because a name alone is not enough: the chat's
 *  live row is `streaming` whatever reply part it shows, so every part was
 *  `streaming:0:0`, and part two was cut with part one's pills and deleted
 *  their memory (review of c3e62696). Text alone is not enough either: a
 *  recycled cell's next message can begin with the last one's words. */
function sameMessage(was: { identity: string | undefined; document: string }, identity: string | undefined, document: string): boolean {
  return was.identity === identity && document.startsWith(was.document)
}

/**
 * Cuts inline code into pills that fill the line they start on, from what
 * each Text's own layout reports (mobile-markdown-code-pill-fit.ts).
 */
export function useMarkdownCodePillRuns(
  textScale: number,
  document: string,
  documentKey: string,
  /** The message the document is, when the caller has a name for it (a chat
   *  list recycles one cell for many). */
  identity: string | undefined
): (textKey: string, lineWidth: number, table: boolean) => CodePillRun {
  // Live cuts per Text and width: a width it comes back to keeps its own.
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map())
  // What this instance last remembered for each Text, so a streaming reply
  // replaces its own entry instead of adding one per update.
  const rememberedHere = useRef(new Map<string, { key: string; document: string; identity: string | undefined }>())
  // The width each Text was first measured at; see keyFor.
  const firstWidths = useRef(new Map<string, number>())
  // The width each Text was last drawn at, and how many times it has come to
  // a width from another; see Entry.visit.
  const visits = useRef(new Map<string, { width: number; visit: number }>())
  const chipScale = markdownChipScale(textScale)
  const factor = chipScale?.factor ?? 1
  // The system font size (Settings > Display > Font size). A pill's text and
  // the words beside it are drawn larger by it, through Android 14's curve
  // where it has one, and its padding and border are not, so cuts learnt at
  // one size are not another's; a pill is cut at it from the first layout
  // (review of 12e3b98e: cut at 1 and left to learn, every first layout at
  // 130% ran its pills past the edge or down a line; review of 63858e9e:
  // priced linearly, at 200% on Android 14 the words read 11% wider than
  // drawn and a path pill went down a line with 700 dp left above it).
  const fontScale = systemFontScale()
  const sp = androidSpScale(fontScale, androidApiLevel())
  // RN sizes an inline view's placeholder with toPixelFromSP of its frame
  // (TextLayoutManager.kt), so at a system font size a pill takes more room
  // on its line than it draws: the frame through the same conversion as
  // text, linear up to Android 13 (30% more at 130%), and on Android 14's
  // curve more for a short pill and none from 100 dp on (review of
  // 63858e9e, which found the comment saying so gone).
  const reserve = fontScale === 1 ? undefined : sp

  return (textKey, lineWidth, table) => {
    // The Text's own type size in sp at the zoom: a table cell's, or prose.
    const baseSize = (table ? MARKDOWN_TABLE_CELL_FONT_SIZE : MARKDOWN_BASE_SIZE) * textScale
    const font: CodePillFont = {
      // A pill's text size in sp, set from its words' (MARKDOWN_CHIP_TEXT_RATIO),
      // drawn in dp at the system font size.
      fontSize: sp.toDp(baseSize * MARKDOWN_CHIP_TEXT_RATIO),
      insets: 2 * (MARKDOWN_CHIP_PADDING_HORIZONTAL * factor + MARKDOWN_CHIP_BORDER_WIDTH),
      reserve: reserve?.toDp
    }
    const measured = lineWidth > 0
    const liveKey = `${textKey}|${lineWidth}`
    const rememberKey = `${textKey}|${lineWidth}|${textScale}|${fontScale}|${documentKey}`
    const live = entries.get(liveKey)
    // A reply streaming in keeps its live cuts as it grows. A list cell
    // recycled for another message takes that message's own, if it has
    // settled before, and otherwise starts clean.
    const entry =
      live && live.fontScale === fontScale && sameMessage(live, identity, document)
        ? live
        : measured
          ? remembered.get(rememberKey)
          : undefined
    const lineRoom = measured ? lineWidth : UNMEASURED_LINE_ROOM
    // A table cell's own type or the prose's; both follow the zoom and the
    // system font size.
    const proseSize = sp.toDp(baseSize)
    // How much larger than the Text's own a span's pill and words are drawn,
    // in dp: 1 but in a heading, whose pills are set from its size.
    const emFor = (size: number | undefined) =>
      size === undefined || size === baseSize
        ? { em: 1, proseEm: 1 }
        : { em: sp.toDp(size * MARKDOWN_CHIP_TEXT_RATIO) / font.fontSize, proseEm: sp.toDp(size) / proseSize }
    const current: TextPillFits = { fits: entry?.fits ?? NO_FITS }
    // The scale a span with no reading of its own is cut with.
    const textScaleNow = textPillScale(current.fits)
    const spans: PillSpanDrawn[] = []
    let backtick = false
    const cutWith = (code: string, firstRoom: number, scale: number, glue: number, guessed: boolean, em = 1) =>
      cutCodePills(code, firstRoom, lineRoom, { ...font, fontSize: font.fontSize * em, scale }, glue, guessed)
    if (measured && !firstWidths.current.has(textKey)) {
      firstWidths.current.set(textKey, lineWidth)
    }
    const seen = visits.current.get(textKey)
    const visit = seen?.width === lineWidth ? seen.visit : (seen?.visit ?? 0) + 1
    if (seen?.width !== lineWidth) {
      visits.current.set(textKey, { width: lineWidth, visit })
    }

    const rememberSettled = () => {
      // Per Text and width: the same message at another width keeps its own.
      const slot = `${textKey}|${lineWidth}|${textScale}|${fontScale}`
      const previous = rememberedHere.current.get(slot)
      if (previous && previous.document !== document && sameMessage(previous, identity, document)) {
        // The same message, grown or edited: its earlier text is never
        // drawn again.
        remembered.delete(previous.key)
        rememberedHere.current.delete(slot)
      }
      if (!entry || entry.fits.size === 0) {
        return
      }
      remembered.delete(rememberKey)
      remembered.set(rememberKey, entry)
      if (remembered.size > REMEMBERED_TEXTS) {
        remembered.delete(remembered.keys().next().value!)
      }
      rememberedHere.current.set(slot, { key: rememberKey, document, identity })
    }
    // What this render draws is what is remembered, not only what a layout
    // read as settled: the last re-cut often lays the lines out exactly as
    // before, Fabric sends no lines it has sent, and a quarter of Texts never
    // read as settled, so scrolled away and back they settled all over
    // again (review of 63858e9e).
    if (entry && entry === live) {
      rememberSettled()
    }

    const read = (event: CodePillTextLayout) => {
      const result = readPillFits({
        lines: event.nativeEvent.lines,
        spans,
        lineWidth,
        current,
        cut: cutWith,
        measure: {
          textWidth: (piece) => codeTextWidth(piece, font.fontSize),
          insets: font.insets,
          reserve: reserve?.toDp,
          frame: reserve?.toSp
        },
        proseSize
      })
      switch (result.kind) {
        case 'unreadable':
          return
        case 'settled':
          rememberSettled()
          return
        case 'changed':
          break
        default: {
          const unhandled: never = result
          return unhandled
        }
      }
      setEntries((prev) => {
        const was = prev.get(liveKey)
        const rounds = was?.document === document && was.visit === visit ? was.rounds + 1 : 1
        if (rounds > 2 * spans.length + 4) {
          return prev
        }
        const epoch = Math.max(was?.epoch ?? 0, entry?.epoch ?? 0) + 1
        const updated: Entry = {
          ...result.next,
          fontScale,
          identity,
          document,
          versions: spans.map((_, ordinal) =>
            ordinal < result.firstChanged ? (entry?.versions[ordinal] ?? 0) : epoch
          ),
          epoch,
          rounds,
          visit
        }
        const map = new Map(prev)
        map.set(liveKey, updated)
        return map
      })
    }

    return {
      table,
      chipScale,
      noteSource: (source) => {
        backtick ||= source.includes('`')
      },
      cut: (code, after, size) => {
        const ordinal = spans.length
        const fit = current.fits.get(ordinal)
        const room = pillFitRoom(fit, lineRoom)
        const { em, proseEm } = emFor(size)
        const glue = codeTextWidth(GLUE.exec(after)![0], proseSize * proseEm)
        const { pieces, fresh } = cutWith(code, room, pillFitScale(fit, textScaleNow), glue, fit?.floor === undefined, em)
        spans.push({ code, pieces, room, fresh, glue, em, proseEm })
        return { pieces, version: entry?.versions[ordinal] ?? 0 }
      },
      mayHoldPills: () => backtick || spans.length > 0,
      keyFor: (base) => {
        const first = firstWidths.current.get(textKey)
        return first === undefined || first === lineWidth || !measured ? String(base) : `${base}@${lineWidth}`
      },
      layoutReader: () => (measured && spans.length > 0 ? read : undefined)
    }
  }
}
