import { useRef, useState } from 'react'
import { PixelRatio } from 'react-native'
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
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_FONT_SIZE,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_TABLE_CHIP_FONT_SIZE,
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
  /** Layouts read for this document and width; a cap against a Text that
   *  never settles (each round re-lays the whole Text). */
  rounds: number
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

/** The system font size (Settings > Display > Font size). All type is drawn
 *  that much larger, a pill's text and the words beside it, and its padding
 *  and border are not, so cuts learnt at one size are not another's; before
 *  anything is read, a pill is cut at it (review of 12e3b98e: cut at 1 and
 *  left to learn, every first layout at 130% ran its pills past the edge or
 *  down a line). 1 where the platform does not say. */
function systemFontScale(): number {
  try {
    return PixelRatio.getFontScale()
  } catch {
    return 1
  }
}

export type CodePillTextLayout = { nativeEvent: { lines: readonly PillLayoutLine[] } }

/** The pills of one Text: how to cut each span, and the Text's layout reader. */
export type CodePillRun = {
  table: boolean
  chipScale: MarkdownChipScale | null
  /** Tells the run the source of an inline stretch it draws, so it knows
   *  whether a code span may be in it (a backtick) before one closes. */
  noteSource: (source: string) => void
  /** The pieces of the next span in this Text, in document order, and the
   *  version its pills are keyed by. `after`: the text that follows it. */
  cut: (code: string, after: string) => { pieces: string[]; version: number }
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
  const chipScale = markdownChipScale(textScale)
  const factor = chipScale?.factor ?? 1
  const fontScale = systemFontScale()

  return (textKey, lineWidth, table) => {
    const font: CodePillFont = {
      fontSize: (table ? MARKDOWN_TABLE_CHIP_FONT_SIZE : MARKDOWN_CHIP_FONT_SIZE) * factor,
      insets: 2 * (MARKDOWN_CHIP_PADDING_HORIZONTAL * factor + MARKDOWN_CHIP_BORDER_WIDTH)
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
    // A table cell is set at BASE - 2; both follow the zoom and the system
    // font size.
    const proseSize = (table ? MARKDOWN_BASE_SIZE - 2 : MARKDOWN_BASE_SIZE) * textScale * fontScale
    const current: TextPillFits = { fits: entry?.fits ?? NO_FITS }
    // The scale a span with no reading of its own is cut with.
    const textScaleNow = textPillScale(current.fits, fontScale)
    const spans: PillSpanDrawn[] = []
    let backtick = false
    const cutWith = (code: string, firstRoom: number, scale: number, glue: number, guessed: boolean) =>
      cutCodePills(code, firstRoom, lineRoom, { ...font, scale }, glue, guessed)
    if (measured && !firstWidths.current.has(textKey)) {
      firstWidths.current.set(textKey, lineWidth)
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

    const read = (event: CodePillTextLayout) => {
      const result = readPillFits({
        lines: event.nativeEvent.lines,
        spans,
        lineWidth,
        current,
        cut: cutWith,
        measure: { textWidth: (piece) => codeTextWidth(piece, font.fontSize), insets: font.insets },
        proseSize,
        guess: fontScale
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
        const rounds = was?.document === document ? was.rounds + 1 : 1
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
          rounds
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
      cut: (code, after) => {
        const ordinal = spans.length
        const fit = current.fits.get(ordinal)
        const room = pillFitRoom(fit, lineRoom)
        const glue = codeTextWidth(GLUE.exec(after)![0], proseSize)
        const { pieces, fresh } = cutWith(code, room, pillFitScale(fit, textScaleNow), glue, fit?.floor === undefined)
        spans.push({ code, pieces, room, fresh, glue })
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
