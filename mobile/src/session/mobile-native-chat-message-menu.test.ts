import { describe, expect, it } from 'vitest'
import {
  CHAT_MESSAGE_MENU_LABELS,
  chatMessageMenuEntries,
  chatMessageMenuHeight,
  chatMessageMenuPlacement,
  MESSAGE_MENU_ALPHA_SPRING,
  MESSAGE_MENU_CLOSED_SCALE,
  MESSAGE_MENU_MIN_WIDTH,
  MESSAGE_MENU_PAD_Y,
  MESSAGE_MENU_ROW_HEIGHT,
  MESSAGE_MENU_SCALE_SPRING,
  MESSAGE_MENU_VERTICAL_MARGIN
} from './mobile-native-chat-message-menu'

// com.anthropic.claude 1.261013.20, the user's 2026-10-15 recording of a hold on a sent prompt:
// the card drops from the bubble's bottom-end corner with no gap (bubble bottom at 577 px, card
// top at 578 px, both right edges at 1035 px, 450 dpi), "Copy message" and "Select text". It is
// Material 3's DropdownMenu (oxb.a -> ccr.d) hung from a zero-size Box aligned BottomEnd in the
// bubble (qs30.a, dlg.D), placed by DropdownMenuPositionProvider (wdd: 48 dp vertical margin, no
// horizontal margin; candidates ljl cases 11 and 12).

const window = { width: 390, height: 844 }
const insets = { top: 24, bottom: 16, left: 0, right: 0 }
const twoRows = chatMessageMenuHeight(2)
const card = { width: 171, height: twoRows }

describe("the Claude app's message menu entries", () => {
  it('labels the rows as the app does: "Copy message" and "Select text"', () => {
    // chat_message_bottom_sheet_menu_copy / _select, the strings gy30.e draws on a sent prompt.
    expect(chatMessageMenuEntries({ hasText: true, waiting: false }).map((entry) => CHAT_MESSAGE_MENU_LABELS[entry])).toEqual([
      'Copy message',
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

  it('is 48 dp a row with 8 dp above and below, as Material’s menu is', () => {
    expect(MESSAGE_MENU_ROW_HEIGHT).toBe(48)
    expect(MESSAGE_MENU_PAD_Y).toBe(8)
    expect(chatMessageMenuHeight(1)).toBe(64)
    expect(twoRows).toBe(112)
  })

  it('opens and closes on the standard motion scheme’s fast springs, from 80 % scale', () => {
    // pql.a: scale ysk.Q(1) = tdm.c, spring(0.9, 1400); alpha ysk.Q(4) = tdm.f, spring(1, 3800).
    expect(MESSAGE_MENU_CLOSED_SCALE).toBe(0.8)
    expect(MESSAGE_MENU_SCALE_SPRING.stiffness).toBe(1400)
    expect(MESSAGE_MENU_SCALE_SPRING.damping / (2 * Math.sqrt(1400))).toBeCloseTo(0.9, 5)
    expect(MESSAGE_MENU_ALPHA_SPRING.stiffness).toBe(3800)
    expect(MESSAGE_MENU_ALPHA_SPRING.damping / (2 * Math.sqrt(3800))).toBeCloseTo(1, 5)
  })
})

describe('where the menu card hangs from a sent prompt', () => {
  const bubble = (y: number, height: number) => ({ x: 200, y, width: 170, height })

  it('drops from the bubble’s bottom-end corner with no gap, its right edge on the bubble’s', () => {
    const placed = chatMessageMenuPlacement({ anchor: bubble(100, 60), card, window, insets })
    expect(placed.top).toBe(160)
    expect(placed.right).toBe(390 - 370)
    expect(placed.left).toBeUndefined()
    expect(placed.transformOrigin).toEqual({ x: 1, y: 0 })
  })

  it('with no room below, sits with its bottom on the bubble’s bottom, over the bubble’s last lines', () => {
    // Bubble bottom 700: 700 + 112 passes 844 - 16 - 48, so the card goes up, not above the bubble.
    const placed = chatMessageMenuPlacement({ anchor: bubble(500, 200), card, window, insets })
    expect(placed.top).toBe(700 - twoRows)
    expect(placed.right).toBe(20)
    expect(placed.transformOrigin).toEqual({ x: 1, y: 1 })
  })

  it('keeps the 48 dp margin: a card that would end 47 dp from the bottom goes up', () => {
    const lastBelow = window.height - insets.bottom - MESSAGE_MENU_VERTICAL_MARGIN - twoRows
    expect(chatMessageMenuPlacement({ anchor: bubble(lastBelow - 60, 60), card, window, insets }).top).toBe(lastBelow)
    expect(chatMessageMenuPlacement({ anchor: bubble(lastBelow - 59, 60), card, window, insets }).top).toBe(
      lastBelow + 1 - twoRows
    )
  })

  it('centres on the bubble’s bottom in a window too short for either side', () => {
    const short = { width: 390, height: 300 }
    const none = { top: 0, bottom: 0, left: 0, right: 0 }
    const placed = chatMessageMenuPlacement({ anchor: bubble(90, 60), card, window: short, insets: none })
    expect(placed.top).toBe(150 - twoRows / 2)
    expect(placed.transformOrigin.y).toBeCloseTo(0.5, 5)
  })

  it('keeps 48 dp off the bottom even going up: a bubble ending 40 dp from it gets its card pinned', () => {
    const placed = chatMessageMenuPlacement({ anchor: bubble(600, 188), card, window, insets })
    expect(placed.top).toBe(window.height - insets.bottom - MESSAGE_MENU_VERTICAL_MARGIN - twoRows)
  })

  it('pins a very long prompt’s card 48 dp above the bottom when the bubble runs off screen', () => {
    const placed = chatMessageMenuPlacement({ anchor: bubble(-2000, 5000), card, window, insets })
    expect(placed.top).toBe(window.height - insets.bottom - MESSAGE_MENU_VERTICAL_MARGIN - twoRows)
  })

  it('pins the card 48 dp under the top when the bubble’s bottom has scrolled above it', () => {
    const placed = chatMessageMenuPlacement({ anchor: bubble(-300, 200), card, window, insets })
    expect(placed.top).toBe(insets.top + MESSAGE_MENU_VERTICAL_MARGIN)
  })

  it('places a one-row card (Undo send alone would be one) under the bubble', () => {
    const one = { width: 140, height: chatMessageMenuHeight(1) }
    // Room under the bubble ends at 844 - 16 - 48 - 64 = 716.
    expect(chatMessageMenuPlacement({ anchor: bubble(660, 40), card: one, window, insets }).top).toBe(700)
    expect(chatMessageMenuPlacement({ anchor: bubble(680, 40), card: one, window, insets }).top).toBe(720 - 64)
  })

  it('starts at the anchor when the card fits to its right, as Material’s first candidate does', () => {
    // A point at the window's left (a view that could not be measured): start-to-start fits.
    const placed = chatMessageMenuPlacement({ anchor: { x: 0, y: 300, width: 0, height: 0 }, card, window, insets })
    expect(placed.left).toBe(0)
    expect(placed.right).toBeUndefined()
    expect(placed.transformOrigin.x).toBe(0)
  })

  it('stays inside a window narrower than the card’s minimum', () => {
    const tiny = { width: MESSAGE_MENU_MIN_WIDTH - 20, height: 844 }
    const placed = chatMessageMenuPlacement({
      anchor: { x: 100, y: 100, width: 50, height: 40 },
      card: { width: MESSAGE_MENU_MIN_WIDTH, height: twoRows },
      window: tiny,
      insets
    })
    // Neither end fits: Material centres a card wider than the window.
    expect(placed.left).toBe(Math.round((tiny.width - MESSAGE_MENU_MIN_WIDTH) / 2))
  })
})
