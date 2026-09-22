import { appendBufferedDictation } from '../terminal/terminal-live-dictation-routing'

/**
 * Android's continuous recognizer works in segments: each final result closes a
 * segment and the next partials describe a new one. The text on screen is every
 * closed segment followed by the open one.
 */
export function composeLiveTranscript(finalSegments: readonly string[], interim: string): string {
  const parts = [...finalSegments, interim].map((part) => part.trim()).filter(Boolean)
  return parts.join(' ')
}

/** What the composer shows while dictating: the text that was there when the
 *  mic went down, then the live transcript after it. */
export function applyLiveTranscript(base: string, transcript: string): string {
  const text = transcript.trim()
  return text ? appendBufferedDictation(base, text) : base
}

/** No speech for this long ends the take. The words stay in the composer. */
export const DICTATION_SILENCE_STOP_MS = 4000

function withWordGap(left: string, right: string): string {
  if (!left || !right) {
    return left + right
  }
  if (/\s$/.test(left) || /^\s/.test(right)) {
    return left + right
  }
  return `${left} ${right}`
}

/** Spoken words go in at the caret. Text before and after the caret stays. */
export function joinDictationAtCursor(prefix: string, suffix: string, spoken: string): string {
  const words = spoken.trim()
  if (!words) {
    return prefix + suffix
  }
  return withWordGap(withWordGap(prefix, words), suffix)
}

export type DictationPaint = {
  before: string
  interim: string
  after: string
}

/** Finished words stay in `before`/`after`. The open phrase is `interim`. */
export function paintSpokenAtCursor(
  prefix: string,
  suffix: string,
  spoken: string,
  interim: string
): DictationPaint & { text: string } {
  const text = joinDictationAtCursor(prefix, suffix, spoken)
  const open = interim.trim()
  if (!open) {
    return { before: text, interim: '', after: '', text }
  }
  const spokenJoined = joinDictationAtCursor(prefix, '', spoken)
  const at = spokenJoined.lastIndexOf(open)
  if (at === -1) {
    return { before: text, interim: '', after: '', text }
  }
  return {
    before: spokenJoined.slice(0, at),
    interim: spokenJoined.slice(at, at + open.length),
    after: text.slice(at + open.length),
    text
  }
}
