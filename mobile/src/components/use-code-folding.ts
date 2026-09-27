import { useCallback, useMemo, useState } from 'react'
import type { FileReaderLineRange } from '../session/mobile-file-reader-line-selection'
import type { MobileCodeDocument } from './mobile-code-document'
import { listIndexOfLine, rangeCoveringFolds, visibleLineIndices, type CodeFoldRegion } from './mobile-code-folding'

export type CodeFolding = {
  document: MobileCodeDocument
  /** The lines the list draws, in order (0-based). */
  visible: number[]
  /** The block whose header is this line (0-based), if it starts one. */
  regionAt: (lineIndex: number) => CodeFoldRegion | undefined
  isFolded: (lineIndex: number) => boolean
  toggle: (lineIndex: number) => void
  /** A 1-based line selection grown over the folded blocks it takes in. */
  coverFolds: (range: FileReaderLineRange) => FileReaderLineRange
  /** The 1-based line whose row shows this one: itself, or the header of the
   *  folded block hiding it. */
  shownLine: (lineNumber: number) => number
}

const NOTHING_FOLDED: ReadonlySet<number> = new Set()
const NO_REGIONS: ReadonlyMap<number, CodeFoldRegion> = new Map()
const NO_LINES: number[] = []

/**
 * Which blocks of a document are folded. Kept per document: a new document
 * (the file's content changed, or another file) starts with nothing folded,
 * as the desktop does when a file is replaced under it.
 */
export function useCodeFolding(document: MobileCodeDocument, active = true): CodeFolding {
  const [state, setState] = useState<{ doc: MobileCodeDocument; folded: ReadonlySet<number> }>({
    doc: document,
    folded: NOTHING_FOLDED
  })
  const folded = state.doc === document ? state.folded : NOTHING_FOLDED
  // A view handed its caller's folds keeps none of its own: no map, and no
  // index of every visible line (22 ms at 208k lines on Hermes).
  const byStart = useMemo(
    () => (active ? new Map(document.folds.map((region) => [region.start, region])) : NO_REGIONS),
    [active, document]
  )
  const visible = useMemo(
    () => (active ? visibleLineIndices(document.lines.length, document.folds, folded) : NO_LINES),
    [active, document, folded]
  )
  const toggle = useCallback(
    (lineIndex: number) => {
      if (!byStart.has(lineIndex)) {
        return
      }
      setState((previous) => {
        const next = new Set(previous.doc === document ? previous.folded : NOTHING_FOLDED)
        if (!next.delete(lineIndex)) {
          next.add(lineIndex)
        }
        return { doc: document, folded: next }
      })
    },
    [byStart, document]
  )
  const regionAt = useCallback((lineIndex: number) => byStart.get(lineIndex), [byStart])
  const isFolded = useCallback((lineIndex: number) => folded.has(lineIndex), [folded])
  const coverFolds = useCallback(
    (range: FileReaderLineRange) => rangeCoveringFolds(range, document.folds, folded),
    [document, folded]
  )
  const shownLine = useCallback(
    (lineNumber: number) =>
      folded.size === 0 || visible.length === 0 ? lineNumber : visible[listIndexOfLine(visible, lineNumber - 1)]! + 1,
    [folded, visible]
  )
  return useMemo(
    () => ({ document, visible, regionAt, isFolded, toggle, coverFolds, shownLine }),
    [coverFolds, document, isFolded, regionAt, shownLine, toggle, visible]
  )
}
