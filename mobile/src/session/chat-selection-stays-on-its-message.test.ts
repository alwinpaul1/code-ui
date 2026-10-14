import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConsecutiveNumbers } from '@shopify/flash-list/dist/recyclerview/helpers/ConsecutiveNumbers'
import { RenderStackManager } from '@shopify/flash-list/dist/recyclerview/RenderStackManager'
import * as listData from './mobile-native-chat-list-extra-data'

// The user's phone, 2026-10-14 13:30 (0.9.141): a paragraph held and selected, the transcript
// scrolled, and the highlight came back on other words, "match" in another paragraph, then a
// block of a different message. The Claude app keeps the selection on the words it was made on.
//
// The chat list is FlashList 2.3.2. In RenderStackManager.sync (dist/recyclerview/
// RenderStackManager.js, src lines 66-98) a row leaving the engaged window has its key put in its
// item type's pool, and a message entering the window in the same sync takes it; the pool cap
// (`maxItemsInRecyclePool`) is applied only afterwards (lines 178-198), and it is also what
// unmounts a row that leaves the window. With one item type for every message, a scroll handed the
// row holding a selection, TextViews and all, to another message.
//
// 8827567bf gave every message its own type, which stopped that and stopped all recycling with it
// (a cost on every scroll). Now only a row holding a selection has its own type: every other row
// recycles as FlashList means it to, and the selected row is neither reused nor, without a pool
// cap, unmounted when it leaves the window, so its selection is there when the reader comes back.
//
// These tests drive FlashList's own RenderStackManager with the item type and pool cap the chat
// gives it.

type Row = { id: string }

const itemTypeOf = (listData as {
  chatRowItemType?: (row: Row, held?: ReadonlySet<string>) => string
}).chatRowItemType!

/** The pool cap the chat list passes (none: FlashList's own default). */
function chatPoolCap(): number | undefined {
  const view = readFileSync(new URL('./MobileNativeChatView.tsx', import.meta.url), 'utf8')
  const cap = /maxItemsInRecyclePool=\{(\d+)\}/.exec(view)
  return cap ? Number(cap[1]) : undefined
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: `m${index}` }))
}

type Drawn = { drew: Map<string, Set<string>>; stack: RenderStackManager }

/** A list of `data` scrolled through `windows` in turn, with `held` holding a selection; returns
 *  every message each row (key) drew, and the stack as it ends. */
function scroll(data: Row[], windows: Array<[number, number]>, held: ReadonlySet<string> = new Set()): Drawn {
  const stack = new RenderStackManager(chatPoolCap())
  const drew = new Map<string, Set<string>>()
  for (const [first, last] of windows) {
    stack.sync(
      (index) => data[index]!.id,
      (index) => itemTypeOf(data[index]!, held),
      new ConsecutiveNumbers(first, last),
      data.length
    )
    for (const [key, info] of stack.getRenderStack()) {
      const seen = drew.get(key) ?? new Set<string>()
      seen.add(info.stableId)
      drew.set(key, seen)
    }
  }
  return { drew, stack }
}

/** The rows that drew `id`, and every message each of them drew. */
function rowsOf(drew: Map<string, Set<string>>, id: string): string[][] {
  return [...drew.values()].filter((ids) => ids.has(id)).map((ids) => [...ids])
}

/** Four rows on screen, scrolled a row at a time from `from` to `to`. */
function steps(from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const step = from <= to ? 1 : -1
  for (let first = from; first !== to + step; first += step) {
    out.push([first, first + 3])
  }
  return out
}

describe('a selection stays on the text it was made on while the list scrolls, never on another message', () => {
  it('never hands the row holding a selection to another message, however far the reader scrolls', () => {
    const held = new Set(['m2'])
    const { drew, stack } = scroll(rows(80), [...steps(0, 70), ...steps(70, 0)], held)
    expect(rowsOf(drew, 'm2')).toEqual([['m2']])
    // And it stayed drawn the whole way, so the selection in it was never torn down.
    expect([...stack.getRenderStack().values()].some((info) => info.stableId === 'm2')).toBe(true)
  })

  it('keeps the selected row drawn while it is 60 rows off screen', () => {
    const { stack } = scroll(rows(80), steps(0, 64), new Set(['m1']))
    const m1 = [...stack.getRenderStack().values()].find((info) => info.stableId === 'm1')
    expect(m1, 'the selected row unmounted when it left the window').toBeDefined()
  })

  it('recycles every row without a selection again, as FlashList means to', () => {
    const { drew } = scroll(rows(40), steps(0, 30), new Set(['m2']))
    const reusedRows = [...drew.values()].filter((ids) => ids.size > 1 && !ids.has('m2'))
    expect(reusedRows.length).toBeGreaterThan(0)
  })

  it('never reuses the row of the last message when it holds the selection, away and back', () => {
    const data = rows(12)
    const { drew } = scroll(data, [[8, 11], [0, 3], [8, 11]], new Set(['m11']))
    expect(rowsOf(drew, 'm11')).toEqual([['m11']])
  })

  it('keeps one message on its own row (one message, nowhere to scroll)', () => {
    const { drew } = scroll(rows(1), [[0, 0], [0, 0]], new Set(['m0']))
    expect([...drew.values()].map((ids) => [...ids])).toEqual([['m0']])
  })

  it('draws nothing for an empty transcript', () => {
    // ConsecutiveNumbers.EMPTY is (-1, -2): no index engaged.
    expect(scroll([], [[-1, -2]]).drew.size).toBe(0)
  })

  it('gives rows without a selection one shared type and a selected row its own', () => {
    const held = new Set(['b'])
    expect(itemTypeOf({ id: 'a' }, held)).toBe(itemTypeOf({ id: 'c' }, held))
    expect(itemTypeOf({ id: 'b' }, held)).not.toBe(itemTypeOf({ id: 'a' }, held))
    const view = readFileSync(new URL('./MobileNativeChatView.tsx', import.meta.url), 'utf8')
    expect(view).toMatch(/getItemType=\{getItemType\}/)
  })
})
