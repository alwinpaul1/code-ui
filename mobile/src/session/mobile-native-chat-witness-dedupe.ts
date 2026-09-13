import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'

/** Whether `longer` is `shorter` plus a suffix starting at a word boundary. */
export function extendsAtWordBoundary(shorter: string, longer: string): boolean {
  return (
    longer.length > shorter.length &&
    longer.startsWith(shorter) &&
    (longer[shorter.length] === ' ' || shorter.endsWith(' '))
  )
}

/**
 * Two readings of the same witnessed message, decided.
 *
 * The queue box cuts a long entry short with `…`, so a reading that ends in
 * one is incomplete and a longer reading replaces it. Any other reading is
 * complete, and a longer reading that merely extends it is the screen's own
 * rows glued on — the running tool's status line under a prompt produced
 * "…dude Running 1 shell command…" and "…dude Capturing the phone screen
 * right now" beside the clean text (2026-09-13). The clean one wins.
 *
 * Returns which of the two to keep, or null when they are different messages.
 */
export function preferredWitnessReading(a: string, b: string): 'a' | 'b' | null {
  const ka = normalizeNativeChatUserText(a)
  const kb = normalizeNativeChatUserText(b)
  if (ka === kb) {
    return 'a'
  }
  // A `…` stub may have been cut mid-word, so it needs no word boundary.
  const stemA = stubStem(ka)
  if (stemA !== null && kb.length > stemA.length && kb.startsWith(stemA)) {
    return 'b'
  }
  const stemB = stubStem(kb)
  if (stemB !== null && ka.length > stemB.length && ka.startsWith(stemB)) {
    return 'a'
  }
  if (extendsAtWordBoundary(ka, kb)) {
    return 'a'
  }
  if (extendsAtWordBoundary(kb, ka)) {
    return 'b'
  }
  return null
}

function stubStem(key: string): string | null {
  return key.endsWith('…') ? key.slice(0, -1).trimEnd() : null
}

/** Drop every reading another reading in the list beats. Keeps order. */
export function dedupeWitnessReadings<T>(items: readonly T[], text: (item: T) => string): T[] {
  const out: T[] = []
  for (const item of items) {
    let beaten = false
    for (let index = 0; index < out.length; index += 1) {
      const verdict = preferredWitnessReading(text(out[index] as T), text(item))
      if (verdict === 'a') {
        beaten = true
        break
      }
      if (verdict === 'b') {
        out.splice(index, 1)
        index -= 1
      }
    }
    if (!beaten) {
      out.push(item)
    }
  }
  return out
}
