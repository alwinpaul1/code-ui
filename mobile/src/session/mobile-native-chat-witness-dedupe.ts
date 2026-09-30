import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'

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
 * Only for two readings that may be one message. Two entries of the queue
 * box, or two readings it first listed with a row written between, are two
 * messages whatever their words (2026-09-30): use-absorbed-queue-echoes.ts and
 * the store (preferredStoredReading) tell those apart before asking.
 *
 * Returns which of the two to keep, or null when they are different messages.
 */
export function preferredWitnessReading(a: string, b: string): 'a' | 'b' | null {
  const ka = normalizeNativeChatUserText(asPaintedPrompt(a))
  const kb = normalizeNativeChatUserText(asPaintedPrompt(b))
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

/** A row only the agent's TUI paints: a tool's dot ("⏺", or "●" off macOS)
 *  or the `⎿` of its result or hint. Not words shaped like a tool: a person
 *  types "QueueEditor() still hangs" or "Read 3 files in src first" under a
 *  repeated question, and both were suppressed as tool rows in review
 *  (2026-09-27). */
function isToolRowLine(line: string): boolean {
  return /^[⏺●⎿]/.test(line.trim())
}

/**
 * Whether a screen reading is a message already known here, whole and on its
 * own lines at the top, with rows of the agent's screen joined on under it,
 * one of them a row only the TUI paints (`isToolRowLine`).
 *
 * The queue reader once walked from a queued row up into the transcript and
 * read the prompt Claude had taken, with the running tool's description and
 * its `⎿ $ …` rows, as a queued message (Claude Code 2.1.283, 2026-09-27). The
 * copy never equalled the send it began with, so nothing retired it, and the
 * chat drew the message a second time with the tool's rows inside the bubble.
 * The reader now stops at the `⎿` row; this keeps any reading shaped like it
 * from becoming a bubble. A longer message that starts with an earlier one's
 * words and goes on in the user's own words is a different message and is
 * kept.
 *
 * What it costs: a message that repeats an earlier send word for word and
 * then pastes a line from the terminal starting with a glyph ("⎿  Error: …")
 * is taken for the glued copy and not drawn from the queue box.
 *
 * `known` holds keys: `normalizeNativeChatUserText(asPaintedPrompt(text))`.
 * An empty key (a message of photos alone) is never a head.
 */
export function readingGluesToolRowsOnto(known: ReadonlySet<string>, reading: string): boolean {
  const lines = reading.split('\n')
  for (let end = 1; end < lines.length; end += 1) {
    const head = normalizeNativeChatUserText(asPaintedPrompt(lines.slice(0, end).join('\n')))
    if (head.length > 0 && known.has(head)) {
      // The shortest known head leaves the longest tail, and a longer head's
      // tail is part of it, so the first match decides.
      return lines.slice(end).some(isToolRowLine)
    }
  }
  return false
}

function stubStem(key: string): string | null {
  return key.endsWith('…') ? key.slice(0, -1).trimEnd() : null
}

/** Drop every reading another reading in the list beats. Keeps order.
 *  `prefer` decides a pair; by default, by their words alone. */
export function dedupeWitnessReadings<T>(
  items: readonly T[],
  text: (item: T) => string,
  prefer: (a: T, b: T) => 'a' | 'b' | null = (a, b) => preferredWitnessReading(text(a), text(b))
): T[] {
  const out: T[] = []
  for (const item of items) {
    let beaten = false
    for (let index = 0; index < out.length; index += 1) {
      const verdict = prefer(out[index] as T, item)
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
