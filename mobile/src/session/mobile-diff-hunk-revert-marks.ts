// Which hunks have already been put back. Held outside the card because no
// component in the chat list lives long enough to hold it: the list drops
// off-screen cells (maxItemsInRecyclePool is 0), the tool line drops the card
// when it collapses, and the global Tools toggle remounts every run. A hunk
// reverted once must not be offered again after any of those, or a second tap
// would go to the host only to be refused by the drift check — a dead button
// that looks live.
//
// Keyed by which card the hunk is on and what the hunk IS: the card's scope
// (the message it came from and its place in that message), the file's path,
// the hunk's rows and its position. Two renders of one card share a key. A
// later message that re-applies the very same edit is another card: it has
// not been reverted, and it must not say so.

import type { NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import type { MobileDiffHunk } from './mobile-diff-hunks'

/** Bounds the set for a long session; the oldest mark goes first. */
const MAX_MARKS = 512
const SEPARATOR = '\u0000'

const marks = new Set<string>()

/** The line shifts the phone's own reverts made on one card, by the card's
 *  numbered position. A hunk reverted at line P that put back M lines for N
 *  removed moves every later hunk on that card by M − N; the card's numbers
 *  do not know that, but the phone does, because it did it. Per card, not per
 *  path: a later card's numbers already include what happened before it. */
type CardShift = { position: number; delta: number }
const cardShifts = new Map<string, CardShift[]>()

export function hunkRevertMarkKey(
  scope: string,
  file: NativeChatEditFile,
  hunk: MobileDiffHunk
): string {
  const rows: string[] = []
  for (let index = hunk.startIndex; index <= hunk.endIndex; index += 1) {
    const line = file.lines[index]
    if (line) {
      rows.push(`${line.kind}${SEPARATOR}${line.text}`)
    }
  }
  return [
    scope,
    file.path,
    String(hunk.firstLineNumber ?? ''),
    String(hunk.startIndex),
    ...rows
  ].join(SEPARATOR)
}

/** What a card IS: where it came from, its path and every row. Two renders of
 *  one card share it; a later card for the same edit does not. */
export function cardRevertKey(scope: string, file: NativeChatEditFile): string {
  return [
    scope,
    file.path,
    ...file.lines.map((line) => `${line.kind}${SEPARATOR}${line.text}`)
  ].join(SEPARATOR)
}

export function recordCardRevertShift(cardKey: string, position: number, delta: number): void {
  const shifts = cardShifts.get(cardKey) ?? []
  cardShifts.delete(cardKey)
  cardShifts.set(cardKey, [...shifts, { position, delta }])
  while (cardShifts.size > MAX_MARKS) {
    const oldest = cardShifts.keys().next().value
    if (oldest === undefined) {
      break
    }
    cardShifts.delete(oldest)
  }
}

/** How far the phone's earlier reverts on this card moved a hunk that the
 *  card numbers at `position`: the sum of the shifts made above it. */
export function cardRevertShiftBefore(cardKey: string, position: number): number {
  let shift = 0
  for (const entry of cardShifts.get(cardKey) ?? []) {
    if (entry.position < position) {
      shift += entry.delta
    }
  }
  return shift
}

export function isHunkMarkedReverted(key: string): boolean {
  return marks.has(key)
}

export function markHunkReverted(key: string): void {
  marks.delete(key)
  marks.add(key)
  while (marks.size > MAX_MARKS) {
    const oldest = marks.values().next().value
    if (oldest === undefined) {
      break
    }
    marks.delete(oldest)
  }
}

export function resetHunkRevertMarksForTests(): void {
  marks.clear()
  cardShifts.clear()
}
