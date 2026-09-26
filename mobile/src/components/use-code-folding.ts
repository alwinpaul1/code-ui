import { useCallback, useMemo, useState } from 'react'
import type { FileReaderLineRange } from '../session/mobile-file-reader-line-selection'
import type { MobileCodeDocument } from './mobile-code-document'
import { rangeCoveringFolds, visibleLineIndices, type CodeFoldRegion } from './mobile-code-folding'

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
}

const NOTHING_FOLDED: ReadonlySet<number> = new Set()

/**
 * Which blocks of a document are folded. Kept per document: a new document
 * (the file's content changed, or another file) starts with nothing folded,
 * as the desktop does when a file is replaced under it.
 */
export function useCodeFolding(document: MobileCodeDocument): CodeFolding {
  const [state, setState] = useState<{ doc: MobileCodeDocument; folded: ReadonlySet<number> }>({
    doc: document,
    folded: NOTHING_FOLDED
  })
  const folded = state.doc === document ? state.folded : NOTHING_FOLDED
  const byStart = useMemo(() => new Map(document.folds.map((region) => [region.start, region])), [document])
  const visible = useMemo(
    () => visibleLineIndices(document.lines.length, document.folds, folded),
    [document, folded]
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
  return useMemo(
    () => ({ document, visible, regionAt, isFolded, toggle, coverFolds }),
    [coverFolds, document, isFolded, regionAt, toggle, visible]
  )
}
