import { useCallback, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'

/**
 * How tall the composer's `/` and `@` popover may be.
 *
 * The dock is absolutely positioned at the bottom and the popover sits
 * inside it, so a fixed cap grew the dock up under the header and tab strip:
 * with the keyboard open the first rows were painted behind the tab strip
 * (device, 2026-09-20, "/thermo-nuclear-review" cut in half). The Claude app
 * keeps its card inside the space between header and composer, keyboard or
 * not. So the cap is the room actually left: the chat view's height above
 * the keyboard, less the dock as it stands WITHOUT the popover, less a gap.
 */

/** One row: a single line of body text with its padding. */
export const SUGGESTION_ROW_HEIGHT = 46
/** Never taller than this, however much room there is. */
export const SUGGESTION_POPOVER_CAP = 360
/** Never shorter than this: one row and the top of the next, so a menu in a
 *  cramped layout still reads as scrollable rather than vanishing. */
export const SUGGESTION_POPOVER_FLOOR = Math.round(SUGGESTION_ROW_HEIGHT * 1.5)
/** Air between the popover's top and whatever is above it. */
const SUGGESTION_POPOVER_GAP = 8

export function suggestionPopoverMaxHeight(args: {
  /** The chat view's height minus the keyboard and bottom inset. */
  spaceAboveKeyboard: number
  /** The dock's height while no popover is mounted. */
  dockBaseHeight: number
}): number {
  const { spaceAboveKeyboard, dockBaseHeight } = args
  if (!Number.isFinite(spaceAboveKeyboard) || !Number.isFinite(dockBaseHeight) || spaceAboveKeyboard <= 0) {
    return SUGGESTION_POPOVER_CAP
  }
  const room = spaceAboveKeyboard - dockBaseHeight - SUGGESTION_POPOVER_GAP
  return Math.max(SUGGESTION_POPOVER_FLOOR, Math.min(SUGGESTION_POPOVER_CAP, Math.floor(room)))
}

/**
 * The popover's cap for this render, and the layout handler the popover
 * reports its own height through.
 *
 * The dock's height includes the popover while one is up, so the base — the
 * dock without it — is the dock minus the popover's MEASURED height. That
 * holds when the rest of the dock changes under an open popover (a prompt
 * card arriving, the key strip toggling): the base follows, the cap with it.
 * Until the popover has measured, the last base is held, so the cap never
 * chases its own height for a frame.
 */
export function useSuggestionPopoverMaxHeight(
  suggestionCount: number,
  spaceAboveKeyboard: number,
  dockHeight: number
): { maxHeight: number; onPopoverLayout: (event: LayoutChangeEvent) => void } {
  const dockBaseRef = useRef(dockHeight)
  const [popoverHeight, setPopoverHeight] = useState(0)
  const onPopoverLayout = useCallback(
    (event: LayoutChangeEvent) => setPopoverHeight(event.nativeEvent.layout.height),
    []
  )
  if (suggestionCount === 0) {
    dockBaseRef.current = dockHeight
  } else if (popoverHeight > 0 && dockHeight > popoverHeight) {
    dockBaseRef.current = dockHeight - popoverHeight
  }
  return {
    maxHeight: suggestionPopoverMaxHeight({ spaceAboveKeyboard, dockBaseHeight: dockBaseRef.current }),
    onPopoverLayout
  }
}

/** A view's laid-out height, 0 until measured. */
export function useMeasuredHeight(): [number, (event: LayoutChangeEvent) => void] {
  const [height, setHeight] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height), [])
  return [height, onLayout]
}
