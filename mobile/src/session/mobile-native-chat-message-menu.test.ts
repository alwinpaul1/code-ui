import { describe, expect, it } from 'vitest'
import {
  CHAT_MESSAGE_MENU_LABELS,
  chatMessageMenuEntries,
  chatMessageMenuPlacement,
  MESSAGE_MENU_EDGE,
  MESSAGE_MENU_GAP,
  MESSAGE_MENU_MIN_WIDTH,
  MESSAGE_MENU_PAD_Y,
  MESSAGE_MENU_ROW_HEIGHT
} from './mobile-native-chat-message-menu'

const window = { width: 390, height: 844 }
const insets = { top: 24, bottom: 16, left: 0, right: 0 }
const cardHeight = (rows: number): number => rows * MESSAGE_MENU_ROW_HEIGHT + 2 * MESSAGE_MENU_PAD_Y

describe("the Claude app's message menu entries", () => {
  it('offers Copy and Select text, in that order, labelled as the app labels them', () => {
    expect(chatMessageMenuEntries({ hasText: true, waiting: false }).map((entry) => CHAT_MESSAGE_MENU_LABELS[entry])).toEqual([
      'Copy',
      'Select text'
    ])
  })

  it('puts Undo send in Edit’s place, before Copy, for a waiting message', () => {
    expect(chatMessageMenuEntries({ hasText: true, waiting: true })).toEqual(['undo-send', 'copy', 'select-text'])
  })

  it('offers nothing for a message with no words that is not waiting', () => {
    expect(chatMessageMenuEntries({ hasText: false, waiting: false })).toEqual([])
    expect(chatMessageMenuEntries({ hasText: false, waiting: true })).toEqual(['undo-send'])
  })
})

describe('where the menu card hangs', () => {
  // A point with no box (a hold whose view could not be measured) near the right edge: the card
  // is at least MESSAGE_MENU_MIN_WIDTH wide, so its start is kept that far in from the edge.
  it('keeps a card hung from a point near the right edge inside the window', () => {
    const anchor = { x: window.width - 10, y: 300, width: 0, height: 0 }
    const placed = chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 2, window, insets })
    expect(placed.left).toBe(window.width - insets.right - MESSAGE_MENU_EDGE - MESSAGE_MENU_MIN_WIDTH)
  })

  it('keeps a card hung from a point near the left edge inside the window, from its end', () => {
    const anchor = { x: 10, y: 300, width: 0, height: 0 }
    const placed = chatMessageMenuPlacement({ anchor, alignEnd: true, rows: 2, window, insets })
    expect(placed.right).toBe(window.width - insets.left - MESSAGE_MENU_EDGE - MESSAGE_MENU_MIN_WIDTH)
  })

  it('hangs under a reply, from its start', () => {
    const anchor = { x: 20, y: 100, width: 350, height: 200 }
    expect(chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 2, window, insets })).toEqual({
      top: 300 + MESSAGE_MENU_GAP,
      left: 20
    })
  })

  it('hangs from the end of the user’s own message', () => {
    const anchor = { x: 200, y: 100, width: 170, height: 60 }
    expect(chatMessageMenuPlacement({ anchor, alignEnd: true, rows: 2, window, insets })).toEqual({
      top: 160 + MESSAGE_MENU_GAP,
      right: 20
    })
  })

  it('sits over a message with no room under it', () => {
    const anchor = { x: 20, y: 600, width: 350, height: 200 }
    const placement = chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 2, window, insets })
    expect(placement.top).toBe(600 - MESSAGE_MENU_GAP - cardHeight(2))
  })

  it('stays on screen for a message taller than the screen', () => {
    const anchor = { x: 20, y: -2000, width: 350, height: 5000 }
    const placement = chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 3, window, insets })
    expect(placement.top).toBeGreaterThanOrEqual(insets.top + MESSAGE_MENU_EDGE)
    expect(placement.top + cardHeight(3)).toBeLessThanOrEqual(window.height - insets.bottom - MESSAGE_MENU_EDGE)
  })

  it('keeps off the screen edges for a message drawn against them', () => {
    const anchor = { x: 0, y: 100, width: 390, height: 40 }
    expect(chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 1, window, insets }).left).toBe(MESSAGE_MENU_EDGE)
    expect(chatMessageMenuPlacement({ anchor, alignEnd: true, rows: 1, window, insets }).right).toBe(MESSAGE_MENU_EDGE)
  })

  it('places a one-row card and a point anchor (a view that could not be measured)', () => {
    const anchor = { x: 120, y: 300, width: 0, height: 0 }
    expect(chatMessageMenuPlacement({ anchor, alignEnd: false, rows: 1, window, insets })).toEqual({
      top: 300 + MESSAGE_MENU_GAP,
      left: 120
    })
  })
})
