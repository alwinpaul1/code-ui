import { useEffect, useRef } from 'react'
import type { DictationPaint } from '../hooks/mobile-live-transcript'

// The composer's text box, copied from the Claude app (1.261009.20, decompiled;
// docs/claude-app-implementation-notes.md, "The composer", and docs/claude-app-typography.md,
// "Composer text"): 17 sp at 1.4, 13 dp in from the sides and 8 dp above and below, one to six
// lines and then it scrolls inside itself. Its 8 dp bottom padding plus the 3 dp the 42 dp button
// row leaves above a 36 dp button is Claude's 11 dp from the text to the buttons. Code UI's was
// 4 + 2, so a multi-line draft ran onto the row and a caret drag hit a button (2026-10-11).

export const COMPOSER_TEXT_SIZE = 17
export const COMPOSER_LINE_HEIGHT = COMPOSER_TEXT_SIZE * 1.4
export const COMPOSER_TEXT_PAD_X = 13
export const COMPOSER_TEXT_PAD_Y = 8
/** Whole lines shown before the text scrolls. The height is padding plus whole lines, so a full box
 *  never shows a cut line at its foot (the old 150 dp cap fell 2 dp into a seventh). */
export const COMPOSER_MAX_LINES = 6
/** Lines of draft left in view while the `/` or `@` menu is up. */
const COMPOSER_LINES_WITH_MENU = 2

const pads = COMPOSER_TEXT_PAD_Y * 2

export const composerInputBox = {
  minHeight: pads + COMPOSER_LINE_HEIGHT,
  maxHeight: pads + COMPOSER_MAX_LINES * COMPOSER_LINE_HEIGHT,
  maxHeightWithMenu: pads + COMPOSER_LINES_WITH_MENU * COMPOSER_LINE_HEIGHT
} as const

/**
 * Where the caret goes in this render, or null to leave it to the keyboard.
 *
 * The app's dictation writes `value` from JS on every result, and Android keeps the OLD selection
 * across a JS write, so the caret stayed where dictation began ("…and send| here it should…") while
 * the words landed after it (2026-10-11). The render that brings a NEW paint whose text is `value`
 * places the caret after the spoken words, in the same native update as the text, and only that
 * render: a tap mid-dictation stays put, the final result (which lands after the mic has stopped)
 * is placed like the rest, and a paint for another draft (stale, or typed over) places nothing.
 * Typing, and a keyboard's own dictation or suggestions composing in the field, keep the IME in
 * charge of the caret.
 */
export function useDictationCaret(
  dictationPaint: DictationPaint | null,
  value: string
): { start: number; end: number } | null {
  const placedRef = useRef<DictationPaint | null>(null)
  useEffect(() => {
    placedRef.current = dictationPaint
  }, [dictationPaint])
  if (dictationPaint === null || dictationPaint === placedRef.current || dictationPaint.text !== value) {
    return null
  }
  return { start: dictationPaint.caret, end: dictationPaint.caret }
}
