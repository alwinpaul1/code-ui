import { useEffect, useRef } from 'react'
import type { DictationPaint } from '../hooks/mobile-live-transcript'

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
