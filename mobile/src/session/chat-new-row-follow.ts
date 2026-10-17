import { useEffect, useRef } from 'react'

/** What the Claude app compares, before and after, when the chat's rows change: its
 *  `AutoScrollSnapshot(totalItemsCount, oldestId, newestId, firstVisibleItemIndex,
 *  scrolledIntoFirstRow)` (1.261013.20, `xk2`). Indices count from the newest row, 0 first, as
 *  in an inverted list. */
export type ChatRowsSnapshot = {
  count: number
  oldestId: string | null
  newestId: string | null
  /** The newest-first index of the row nearest the live edge that is on screen. */
  firstVisibleIndex: number
  /** The reader has scrolled more than half a viewport into that row. */
  pastHalfIntoFirstRow: boolean
}

/**
 * Whether new rows should take the reader to the newest message: the Claude app's rule
 * (1.261013.20, `kc0.java:51-66`), read as
 *
 *   the row count grew, and it was not older history paging in (the oldest id changed while the
 *   newest stayed), and BEFORE the change the reader sat on the newest row or the one above it
 *   (`firstVisibleItemIndex <= 1`) without having scrolled more than half a viewport into it.
 *
 * Geometry at the moment the rows land, never a stored intent: there is no "following" flag in
 * the app. Text growing inside a row is not a new row and moves nothing. The app's further check
 * that the index shift is no bigger than the growth (`z3`) needs the list's layout after the
 * change, which React Native has not measured yet; requiring the newest row to be a new one
 * stands in for it (new rows landed at the newest end).
 */
export function newRowsFollow(before: ChatRowsSnapshot | null, after: Omit<ChatRowsSnapshot, 'firstVisibleIndex' | 'pastHalfIntoFirstRow'>): boolean {
  if (before === null || before.count === 0) {
    return false
  }
  const grew = after.count - before.count
  const historyPrepend = after.oldestId !== before.oldestId && after.newestId === before.newestId
  const nearNewest = before.firstVisibleIndex <= 1 && !before.pastHalfIntoFirstRow
  return grew > 0 && !historyPrepend && after.newestId !== before.newestId && nearNewest
}

/** Where the reader sits right now, or null when the list cannot say (no list, not laid out). */
export type ChatRowsGeometry = () => Pick<ChatRowsSnapshot, 'firstVisibleIndex' | 'pastHalfIntoFirstRow'> | null

/**
 * Runs `follow` after a render whose new rows pass `newRowsFollow`. The geometry is read while
 * React renders the new rows, before the list lays them out, so it is where the reader sat when
 * they arrived. `follow` decides whether anything may move the list now (a finger on it may not).
 */
export function useChatNewRowFollow(rows: readonly { id: string }[], geometry: ChatRowsGeometry, follow: () => void): void {
  const seenRef = useRef(rows)
  const dueRef = useRef(false)
  if (seenRef.current !== rows) {
    const was = seenRef.current
    seenRef.current = rows
    const where = geometry()
    dueRef.current =
      where !== null &&
      newRowsFollow(
        { count: was.length, newestId: was[0]?.id ?? null, oldestId: was.at(-1)?.id ?? null, ...where },
        { count: rows.length, newestId: rows[0]?.id ?? null, oldestId: rows.at(-1)?.id ?? null }
      )
  }
  useEffect(() => {
    if (dueRef.current) {
      dueRef.current = false
      follow()
    }
  }, [rows, follow])
}
