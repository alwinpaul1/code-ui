import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConsecutiveNumbers } from '@shopify/flash-list/dist/recyclerview/helpers/ConsecutiveNumbers'
import { RenderStackManager } from '@shopify/flash-list/dist/recyclerview/RenderStackManager'
import * as listData from './mobile-native-chat-list-extra-data'

// The user's phone, 2026-10-14 13:30 (0.9.141): a paragraph held and selected, the transcript
// scrolled, and the highlight came back on other words, "match" in another paragraph, then a
// block of a different message. The Claude app keeps the selection on the words it was made on.
//
// The chat list is FlashList 2.3.2 with `maxItemsInRecyclePool={0}`, set so that "off-screen
// cells leave the window" and every message mounts fresh. It does not do that. In
// RenderStackManager.sync (dist/recyclerview/RenderStackManager.js, src lines 66-98) a cell that
// leaves the engaged window has its key put in its item type's pool (recycleKey), and a message
// entering the window in the SAME sync takes a key from that pool (syncItem ->
// getKeyFromRecyclePool). The pool cap is applied only afterwards, in cleanup (lines 178-198),
// to keys nobody took. So during a scroll the React row that held the selection is handed a
// different message, with every native TextView in it, selection included. Every message had
// one item type ("default"), so any message could take any row.
//
// These tests drive FlashList's own RenderStackManager with the item type the chat gives it.
// A row (a key) must only ever draw the message it was made for.

type Row = { id: string }

/** The chat's item type, as MobileNativeChatView passes it (none: FlashList's "default"). */
const itemTypeOf: (row: Row) => string =
  (listData as { chatRowItemType?: (row: Row) => string }).chatRowItemType ?? (() => 'default')

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: `m${index}` }))
}

/** A list of `data` scrolled through `windows` in turn; returns every message each key drew. */
function scroll(data: Row[], windows: Array<[number, number]>): Map<string, Set<string>> {
  const stack = new RenderStackManager(0)
  const drew = new Map<string, Set<string>>()
  for (const [first, last] of windows) {
    stack.sync(
      (index) => data[index]!.id,
      (index) => itemTypeOf(data[index]!),
      new ConsecutiveNumbers(first, last),
      data.length
    )
    for (const [key, info] of stack.getRenderStack()) {
      const seen = drew.get(key) ?? new Set<string>()
      seen.add(info.stableId)
      drew.set(key, seen)
    }
  }
  return drew
}

/** The keys that drew more than one message: a row reused for another message's words. */
function reused(drew: Map<string, Set<string>>): string[] {
  return [...drew.entries()].filter(([, ids]) => ids.size > 1).map(([key, ids]) => `${key}: ${[...ids].join(' -> ')}`)
}

describe('a selection stays on the text it was made on while the list scrolls, never on another message', () => {
  it('never hands the row holding a message to a different message as the reader scrolls past', () => {
    // Four rows on screen, the reader scrolls a row at a time through twelve messages and back.
    const windows: Array<[number, number]> = []
    for (let first = 0; first <= 8; first += 1) {
      windows.push([first, first + 3])
    }
    for (let first = 8; first >= 0; first -= 1) {
      windows.push([first, first + 3])
    }
    expect(reused(scroll(rows(12), windows))).toEqual([])
  })

  it('never reuses the row of the last message when the reader scrolls away from it and back', () => {
    expect(reused(scroll(rows(6), [[3, 5], [0, 2], [3, 5]]))).toEqual([])
  })

  it('keeps one message on its own row (one message, nowhere to scroll)', () => {
    const drew = scroll(rows(1), [[0, 0], [0, 0], [0, 0]])
    expect(reused(drew)).toEqual([])
    expect(drew.size).toBe(1)
  })

  it('draws nothing for an empty transcript', () => {
    // ConsecutiveNumbers.EMPTY is (-1, -2): no index engaged.
    expect(scroll([], [[-1, -2]]).size).toBe(0)
  })

  it('gives each message its own item type, so the chat list is wired with it', () => {
    expect(itemTypeOf({ id: 'a' })).not.toBe(itemTypeOf({ id: 'b' }))
    const view = readFileSync(new URL('./MobileNativeChatView.tsx', import.meta.url), 'utf8')
    expect(view).toMatch(/getItemType=\{chatRowItemType\}/)
  })
})
