import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  SUGGESTION_POPOVER_CAP,
  SUGGESTION_POPOVER_FLOOR,
  suggestionPopoverMaxHeight,
  useSuggestionPopoverMaxHeight
} from './mobile-native-chat-suggestion-popover'

// 2026-09-20, phone beside the Claude app with the keyboard open: our `/`
// menu grew to its fixed cap and its first rows sat behind the tab strip;
// the Claude app's card stays between the header and the composer.
describe('the / menu with the keyboard open', () => {
  // Measured on the SM-S918B, dp: the chat view under the header is 744 tall;
  // the dock without a popover is 126, plus the keyboard lift it carries in
  // its own bottom padding (314) while the keyboard is open.
  it('fits between the header and the composer instead of the fixed cap', () => {
    const max = suggestionPopoverMaxHeight({ viewHeight: 744, dockBaseHeight: 126 + 314 })
    expect(max).toBeLessThan(SUGGESTION_POPOVER_CAP)
    expect(max).toBe(744 - 440 - 8)
  })

  // 2026-09-20, second install: the menu came up a row and a half tall with
  // the whole chat area empty above it. The keyboard lift had been taken off
  // twice — once from the view's height and once more inside the dock's own
  // measured height, which already includes its bottom padding.
  it('takes the keyboard lift off once: it is inside the dock\'s measured height', () => {
    const withKeyboard = suggestionPopoverMaxHeight({ viewHeight: 744, dockBaseHeight: 126 + 314 })
    const withDoubleCount = suggestionPopoverMaxHeight({ viewHeight: 744 - 314, dockBaseHeight: 126 + 314 })
    expect(withKeyboard).toBe(296)
    expect(withDoubleCount).toBe(SUGGESTION_POPOVER_FLOOR)
  })

  it('keeps the cap when the keyboard is closed and there is room', () => {
    expect(suggestionPopoverMaxHeight({ viewHeight: 744, dockBaseHeight: 126 })).toBe(SUGGESTION_POPOVER_CAP)
  })

  it('never vanishes: a cramped layout still shows a row and a half', () => {
    expect(suggestionPopoverMaxHeight({ viewHeight: 140, dockBaseHeight: 126 })).toBe(SUGGESTION_POPOVER_FLOOR)
    expect(suggestionPopoverMaxHeight({ viewHeight: 0, dockBaseHeight: 126 })).toBe(SUGGESTION_POPOVER_CAP)
  })
})

// Jev's residual (2026-09-20): the dock can change under an open popover — a
// prompt card arrives, the key strip toggles — and a base read once would
// then be wrong. With the popover's own measured height the base is the dock
// minus it, whatever the dock does.
describe('the base the cap is measured from', () => {
  let latest: ReturnType<typeof useSuggestionPopoverMaxHeight> | null = null
  function Probe({ count, dock }: { count: number; dock: number }): null {
    latest = useSuggestionPopoverMaxHeight(count, 744, dock)
    return null
  }
  it('follows the dock while the popover is open, once the popover has measured', () => {
    let renderer: ReactTestRenderer | null = null
    // Keyboard open: the dock is 126 plus its 314 lift.
    act(() => {
      renderer = create(createElement(Probe, { count: 0, dock: 440 }))
    })
    expect(latest!.maxHeight).toBe(744 - 440 - 8)
    // The popover mounts (296 tall) and the dock now includes it.
    act(() => renderer!.update(createElement(Probe, { count: 5, dock: 736 })))
    // Not yet measured: the base is held, the cap unchanged.
    expect(latest!.maxHeight).toBe(744 - 440 - 8)
    act(() => latest!.onPopoverLayout({ nativeEvent: { layout: { height: 296, width: 0, x: 0, y: 0 } } } as never))
    act(() => renderer!.update(createElement(Probe, { count: 5, dock: 736 })))
    expect(latest!.maxHeight).toBe(744 - 440 - 8)
    // A prompt card adds 80 to the dock under the open popover.
    act(() => renderer!.update(createElement(Probe, { count: 5, dock: 816 })))
    expect(latest!.maxHeight).toBe(744 - 520 - 8)
    act(() => renderer!.unmount())
  })
})
