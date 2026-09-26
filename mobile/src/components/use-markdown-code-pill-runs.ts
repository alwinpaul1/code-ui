import { useState } from 'react'
import { codePillWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
import {
  pillFitRoom,
  readPillFits,
  type PillFit,
  type PillLayoutLine,
  type PillSpanDrawn,
  type TextPillFits
} from './mobile-markdown-code-pill-fit'
import {
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_FONT_SIZE,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_TABLE_CHIP_FONT_SIZE,
  markdownChipScale,
  type MarkdownChipScale
} from './mobile-markdown-prose-scale'

/** The line a span is cut to before the document has been measured. */
const UNMEASURED_LINE_ROOM = 280
/** Rooms learnt from layout, kept for a Text that scrolls away and back so it
 *  does not settle all over again. */
const REMEMBERED_TEXTS = 300

type Entry = TextPillFits & {
  lineWidth: number
  /** Bumped on every change, so every pill in the Text remounts. */
  version: number
  /** Layouts read for this document and width; a cap against a Text that
   *  never settles (each round re-lays the whole Text). */
  rounds: number
  documentKey: string
}

const remembered = new Map<string, Entry>()

function remember(key: string, entry: Entry): void {
  remembered.delete(key)
  remembered.set(key, entry)
  if (remembered.size > REMEMBERED_TEXTS) {
    remembered.delete(remembered.keys().next().value!)
  }
}

const NO_FITS: ReadonlyMap<number, PillFit> = new Map()

export type CodePillTextLayout = { nativeEvent: { lines: readonly PillLayoutLine[] } }

/** The pills of one Text: how to cut each span, and the Text's layout reader. */
export type CodePillRun = {
  table: boolean
  chipScale: MarkdownChipScale | null
  version: number
  /** The pieces of the next span in this Text, in document order. */
  cut: (code: string) => string[]
  /** For the Text's `onTextLayout`, asked once its children are drawn:
   *  nothing when it holds no pill or its width is not known yet. */
  layoutReader: () => ((event: CodePillTextLayout) => void) | undefined
}

/** A short key for the document, so remembered rooms are only reused for
 *  the exact text they were learnt on. */
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
  documentKey: string
): (textKey: string, lineWidth: number, table: boolean) => CodePillRun {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map())
  const chipScale = markdownChipScale(textScale)
  const factor = chipScale?.factor ?? 1

  return (textKey, lineWidth, table) => {
    const font: CodePillFont = {
      fontSize: (table ? MARKDOWN_TABLE_CHIP_FONT_SIZE : MARKDOWN_CHIP_FONT_SIZE) * factor,
      insets: 2 * (MARKDOWN_CHIP_PADDING_HORIZONTAL * factor + MARKDOWN_CHIP_BORDER_WIDTH)
    }
    const measured = lineWidth > 0
    const rememberKey = `${textKey}|${lineWidth}|${textScale}|${documentKey}`
    const live = entries.get(textKey)
    // A streaming reply keeps its live rooms as it grows; a Text mounted
    // again takes the ones learnt on exactly this document.
    const entry = live?.lineWidth === lineWidth ? live : measured ? remembered.get(rememberKey) : undefined
    const lineRoom = entry?.lineRoom ?? (measured ? lineWidth : UNMEASURED_LINE_ROOM)
    const fits = entry?.fits ?? NO_FITS
    const spans: PillSpanDrawn[] = []
    const cutWith = (code: string, firstRoom: number, room: number) => cutCodePills(code, firstRoom, room, font)

    const read = (event: CodePillTextLayout) => {
      const next = readPillFits({
        lines: event.nativeEvent.lines,
        spans,
        lineWidth,
        current: { fits, lineRoom },
        cut: cutWith,
        width: (piece) => codePillWidth(piece, font)
      })
      if (!next) {
        return
      }
      setEntries((prev) => {
        const was = prev.get(textKey)
        const rounds =
          was?.documentKey === documentKey && was.lineWidth === lineWidth ? was.rounds + 1 : 1
        if (rounds > 2 * spans.length + 4) {
          return prev
        }
        const updated: Entry = {
          ...next,
          lineWidth,
          version: Math.max(was?.version ?? 0, entry?.version ?? 0) + 1,
          rounds,
          documentKey
        }
        remember(rememberKey, updated)
        const map = new Map(prev)
        map.set(textKey, updated)
        return map
      })
    }

    return {
      table,
      chipScale,
      version: entry?.version ?? 0,
      cut: (code) => {
        const room = pillFitRoom(fits.get(spans.length), lineRoom)
        const { pieces, fresh } = cutWith(code, room, lineRoom)
        spans.push({ code, pieces, room, fresh })
        return pieces
      },
      layoutReader: () => (measured && spans.length > 0 ? read : undefined)
    }
  }
}
