import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import {
  codeDocumentChunkCount,
  codeDocumentChunkOf,
  codeDocumentChunkRange,
  highlightCodeDocumentChunk,
  plainCodeDocumentLine,
  type MobileCodeDocument
} from './mobile-code-document'

type HighlightedChunks = ReadonlyMap<number, MobileSyntaxSegment[][]>

const NO_CHUNKS: HighlightedChunks = new Map()

export type CodeDocumentHighlight = {
  /** Changes identity whenever a chunk gains its colours. */
  chunks: HighlightedChunks
  segmentsFor: (lineIndex: number) => MobileSyntaxSegment[]
  /** Colour the chunks holding these lines, and one either side. */
  requestLines: (firstLine: number, lastLine: number) => void
}

/**
 * Colours a code document off the first paint: the text shows at once, plain,
 * and each chunk's colours land one tick later. A whole-file document is one
 * chunk, asked for on open. A big one is asked for where the reader looks, so
 * its cost follows the scroll rather than the file size.
 */
export function useCodeDocumentHighlight(
  document: MobileCodeDocument,
  initialLine = 0
): CodeDocumentHighlight {
  const [state, setState] = useState<{ doc: MobileCodeDocument; chunks: HighlightedChunks }>({
    doc: document,
    chunks: NO_CHUNKS
  })
  const docRef = useRef(document)
  const requested = useRef<{ doc: MobileCodeDocument; chunks: Set<number> }>({
    doc: document,
    chunks: new Set()
  })
  const pending = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const requestLines = useCallback((firstLine: number, lastLine: number) => {
    const doc = docRef.current
    if (requested.current.doc !== doc) {
      requested.current = { doc, chunks: new Set() }
    }
    const count = codeDocumentChunkCount(doc)
    const from = Math.max(0, codeDocumentChunkOf(doc, firstLine) - 1)
    const to = Math.min(count - 1, codeDocumentChunkOf(doc, lastLine) + 1)
    for (let chunk = from; chunk <= to; chunk += 1) {
      if (requested.current.chunks.has(chunk)) {
        continue
      }
      requested.current.chunks.add(chunk)
      const timer = setTimeout(() => {
        pending.current.delete(chunk)
        const lines = highlightCodeDocumentChunk(doc, chunk)
        setState((previous) => {
          const next = new Map(previous.doc === doc ? previous.chunks : NO_CHUNKS)
          next.set(chunk, lines)
          return { doc, chunks: next }
        })
      }, 0)
      pending.current.set(chunk, timer)
    }
  }, [])

  useEffect(() => {
    docRef.current = document
    requestLines(initialLine, initialLine)
    const waiting = pending.current
    return () => {
      // A chunk that never ran is not requested any more, so the next ask
      // (a re-mount, or this document again) schedules it afresh.
      for (const [chunk, timer] of waiting) {
        clearTimeout(timer)
        requested.current.chunks.delete(chunk)
      }
      waiting.clear()
    }
    // A new initial line on the same document is only a scroll position.
  }, [document, requestLines])

  const chunks = state.doc === document ? state.chunks : NO_CHUNKS
  const segmentsFor = useCallback(
    (lineIndex: number) => {
      const chunk = codeDocumentChunkOf(document, lineIndex)
      const lines = chunks.get(chunk)
      const line = lines?.[lineIndex - codeDocumentChunkRange(document, chunk).start]
      return line ?? plainCodeDocumentLine(document, lineIndex)
    },
    [chunks, document]
  )
  return { chunks, segmentsFor, requestLines }
}
