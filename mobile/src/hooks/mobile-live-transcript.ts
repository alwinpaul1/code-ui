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
