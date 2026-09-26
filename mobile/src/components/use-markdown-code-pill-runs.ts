import { useRef, useState } from 'react'
import { PixelRatio } from 'react-native'
import { codeTextWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
import {
  pillFitRoom,
  readPillFits,
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

type Entry = TextPillFits & {
  lineWidth: number
  fontScale: number
  /** The document these were learnt on. A reply streaming in keeps them as
   *  it grows; another message drawn in the same list cell does not. */
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

const NO_FITS: ReadonlyMap<number, PillFit> = new Map()

/** The system font size (Settings > Display > Font size). Android scales an
 *  inline view's room on the line by it, so cuts learnt at one size are not
 *  another's. 1 where the platform does not say. */
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
  /** The pieces of the next span in this Text, in document order, and the
   *  version its pills are keyed by. `after`: the text that follows it. */
  cut: (code: string, after: string) => { pieces: string[]; version: number }
  /** Whether this Text holds a pill, asked once its children are drawn. */
  holdsPills: () => boolean
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

/**
 * Cuts inline code into pills that fill the line they start on, from what
 * each Text's own layout reports (mobile-markdown-code-pill-fit.ts).
 */
export function useMarkdownCodePillRuns(
  textScale: number,
  document: string,
  documentKey: string
): (textKey: string, lineWidth: number, table: boolean) => CodePillRun {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map())
  // What this instance last remembered for each Text, so a streaming reply
  // replaces its own entry instead of adding one per update.
  const rememberedHere = useRef(new Map<string, { key: string; document: string }>())
  const chipScale = markdownChipScale(textScale)
  const factor = chipScale?.factor ?? 1
  const fontScale = systemFontScale()

  return (textKey, lineWidth, table) => {
    const font: CodePillFont = {
      fontSize: (table ? MARKDOWN_TABLE_CHIP_FONT_SIZE : MARKDOWN_CHIP_FONT_SIZE) * factor,
      insets: 2 * (MARKDOWN_CHIP_PADDING_HORIZONTAL * factor + MARKDOWN_CHIP_BORDER_WIDTH)
    }
    const measured = lineWidth > 0
    const rememberKey = `${textKey}|${lineWidth}|${textScale}|${fontScale}|${documentKey}`
    const live = entries.get(textKey)
    // A reply streaming in keeps its live cuts as it grows. A list cell
    // recycled for another message takes that message's own, if it has
    // settled before, and otherwise starts clean.
    const entry =
      live?.lineWidth === lineWidth && live.fontScale === fontScale && document.startsWith(live.document)
        ? live
        : measured
          ? remembered.get(rememberKey)
          : undefined
    const lineRoom = measured ? lineWidth : UNMEASURED_LINE_ROOM
    // A table cell is set at BASE - 2 and does not follow the zoom.
    const proseSize = table ? MARKDOWN_BASE_SIZE - 2 : MARKDOWN_BASE_SIZE * textScale
    const current: TextPillFits = { fits: entry?.fits ?? NO_FITS, scale: entry?.scale ?? 1 }
    const spans: PillSpanDrawn[] = []
    const cutWith = (code: string, firstRoom: number, scale: number, glue: number) =>
      cutCodePills(code, firstRoom, lineRoom, { ...font, scale }, glue)

    const rememberSettled = () => {
      // Per Text and width: the same message at another width keeps its own.
      const slot = `${textKey}|${lineWidth}|${textScale}|${fontScale}`
      const previous = rememberedHere.current.get(slot)
      if (previous && previous.document !== document && document.startsWith(previous.document)) {
        // The same reply, grown: its earlier document is never drawn again.
        remembered.delete(previous.key)
        rememberedHere.current.delete(slot)
      }
      if (!entry || (entry.fits.size === 0 && entry.scale === 1)) {
        return
      }
      remembered.delete(rememberKey)
      remembered.set(rememberKey, entry)
      if (remembered.size > REMEMBERED_TEXTS) {
        remembered.delete(remembered.keys().next().value!)
      }
      rememberedHere.current.set(slot, { key: rememberKey, document })
    }

    const read = (event: CodePillTextLayout) => {
      const result = readPillFits({
        lines: event.nativeEvent.lines,
        spans,
        lineWidth,
        current,
        cut: cutWith,
        measure: { textWidth: (piece) => codeTextWidth(piece, font.fontSize), insets: font.insets },
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
        const was = prev.get(textKey)
        const rounds =
          was?.document === document && was.lineWidth === lineWidth ? was.rounds + 1 : 1
        if (rounds > 2 * spans.length + 4) {
          return prev
        }
        const epoch = Math.max(was?.epoch ?? 0, entry?.epoch ?? 0) + 1
        const updated: Entry = {
          ...result.next,
          lineWidth,
          fontScale,
          document,
          versions: spans.map((_, ordinal) =>
            ordinal < result.firstChanged ? (entry?.versions[ordinal] ?? 0) : epoch
          ),
          epoch,
          rounds
        }
        const map = new Map(prev)
        map.set(textKey, updated)
        return map
      })
    }

    return {
      table,
      chipScale,
      cut: (code, after) => {
        const ordinal = spans.length
        const room = pillFitRoom(current.fits.get(ordinal), lineRoom)
        // The punctuation after it, up to a space: it cannot break away.
        const glue = codeTextWidth(/^[^\s`\uFFFC]*/.exec(after)![0], proseSize)
        const { pieces, fresh } = cutWith(code, room, current.scale, glue)
        spans.push({ code, pieces, room, fresh, glue })
        return { pieces, version: entry?.versions[ordinal] ?? 0 }
      },
      holdsPills: () => spans.length > 0,
      layoutReader: () => (measured && spans.length > 0 ? read : undefined)
    }
  }
}
