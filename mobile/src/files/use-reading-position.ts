import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native'
import {
  flushReadingPositions,
  loadReadingPosition,
  peekReadingPosition,
  saveReadingPosition,
  type ReadingPosition
} from '../storage/reading-positions'

/**
 * The stored position for `key`: `undefined` while it is being read, `null`
 * when there is none. Readers hold their native view back until it is known,
 * because a PDF that mounts on page 1 and is then told "page 47" visibly
 * jumps, and a ScrollView that paints the top first flashes it.
 *
 * Unmounting flushes any pending write, so a position saved in the last
 * 300 ms leaves with the screen instead of dying with it.
 */
export function useRestoredReadingPosition(
  key: string | null
): ReadingPosition | null | undefined {
  const [restored, setRestored] = useState<{
    key: string | null
    position: ReadingPosition | null | undefined
  }>(() => ({ key, position: key ? peekReadingPosition(key) : null }))
  useEffect(() => {
    if (!key) {
      setRestored({ key, position: null })
      return
    }
    const known = peekReadingPosition(key)
    if (known !== undefined) {
      setRestored({ key, position: known })
      return
    }
    setRestored({ key, position: undefined })
    let cancelled = false
    void loadReadingPosition(key).then((position) => {
      if (!cancelled) {
        setRestored({ key, position })
      }
    })
    return () => {
      cancelled = true
    }
  }, [key])
  useEffect(
    () => () => {
      void flushReadingPositions()
    },
    []
  )
  // A key that changed this render has a stale answer in state until the
  // effect above runs; report "unknown" rather than the previous document's.
  return restored.key === key ? restored.position : undefined
}

export type ScrollReadingPositionProps = {
  ref: (view: ScrollView | null) => void
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  scrollEventThrottle: number
  onContentSizeChange: (width: number, height: number) => void
}

/** Same document rendered at a height within this of the saved one restores
 *  the exact offset; further off, the offset scales with the height. */
const SAME_HEIGHT_TOLERANCE = 0.1

export function resolveRestoredScrollOffset(
  position: Extract<ReadingPosition, { kind: 'scroll' }>,
  contentHeight: number
): number {
  const sameHeight =
    Math.abs(contentHeight - position.contentHeight) <=
    position.contentHeight * SAME_HEIGHT_TOLERANCE
  const offset = sameHeight
    ? position.offset
    : (position.offset * contentHeight) / position.contentHeight
  return Math.max(0, Math.round(offset))
}

/**
 * Props for a ScrollView that remembers where the reader was. Restores once,
 * on the first content size after the stored position is known; saves on
 * every scroll after that. Scroll events before the restore are the previous
 * document's offset clamped into this one and are not saved.
 */
export function useScrollReadingPosition(key: string | null): ScrollReadingPositionProps {
  const restored = useRestoredReadingPosition(key)
  const viewRef = useRef<ScrollView | null>(null)
  const contentHeightRef = useRef(0)
  const restoredForKeyRef = useRef<string | null>(null)
  const appliedRef = useRef(false)

  if (restoredForKeyRef.current !== key) {
    restoredForKeyRef.current = key
    appliedRef.current = false
    // The last height is kept: a new document of the same height fires no
    // onContentSizeChange, and the restore would otherwise wait for one that
    // never comes (review, 2026-09-19).
  }

  const applyIfReady = useCallback(() => {
    if (appliedRef.current || restored === undefined || contentHeightRef.current <= 0) {
      return
    }
    appliedRef.current = true
    if (restored?.kind !== 'scroll') {
      return
    }
    viewRef.current?.scrollTo({
      y: resolveRestoredScrollOffset(restored, contentHeightRef.current),
      animated: false
    })
  }, [restored])

  useEffect(() => {
    applyIfReady()
  }, [applyIfReady])

  // Read through a ref so the callback ref below stays one function for the
  // life of the hook; a changing ref callback is detached and reattached,
  // which would read as a new view.
  const applyRef = useRef(applyIfReady)
  applyRef.current = applyIfReady
  const ref = useCallback((view: ScrollView | null) => {
    const replaced = view !== null && view !== viewRef.current
    viewRef.current = view
    // A new native view starts at the top whatever the old one showed:
    // Preview → Source → Preview remounts the ScrollView and must restore
    // again (review, 2026-09-19).
    if (replaced) {
      appliedRef.current = false
      applyRef.current()
    }
  }, [])

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height
      applyIfReady()
    },
    [applyIfReady]
  )

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!key || !appliedRef.current) {
        return
      }
      const { contentOffset, contentSize } = event.nativeEvent
      if (contentSize.height > 0) {
        contentHeightRef.current = contentSize.height
      }
      saveReadingPosition(key, {
        kind: 'scroll',
        offset: contentOffset.y,
        contentHeight: contentHeightRef.current
      })
    },
    [key]
  )

  return { ref, onScroll, scrollEventThrottle: 100, onContentSizeChange }
}
