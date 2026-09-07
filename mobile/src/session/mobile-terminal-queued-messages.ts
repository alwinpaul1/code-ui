import { normalizeNativeChatUserText } from './mobile-native-chat-image-transcript-markers'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
/** Verified against Claude Code 2.1.263. Two different queue footers exist:
 * the legacy whole-queue recall, and the per-message selector that only appears
 * when CLAUDE_CODE_KB_COHESION_FIXES is set in the agent's environment. */
export const QUEUE_HINT =
  /^\s*[❯›>]?\s*Press up to (?:edit queued messages|select a queued message)\b/i
export const SELECTED_HINT = /^\s*[❯›>]?\s*Press Enter to edit the selected message\b/i

export type ClaudeQueueView = {
  /** Empty while an entry is selected: the rows are ambiguous then. */
  entries: string[]
  /** Claude offers its per-message selector on this build. */
  selectable: boolean
  /** One entry carries the marker right now. */
  selecting: boolean
  /** First rendered line of the marked entry, wrapped as Claude drew it. */
  selected: string | null
  /** The marker is on the oldest entry: Claude offers history above it. */
  selectedOldest: boolean
}

const EMPTY_VIEW: ClaudeQueueView = {
  entries: [],
  selectable: false,
  selecting: false,
  selected: null,
  selectedOldest: false
}

/** Read only the explicit Claude queue block immediately above its queue footer.
 * The screen can show only a subset of a long queue; never use this to rewrite it. */
export function claudeQueueViewFromScreen(
  screen: readonly string[],
  draft?: unknown
): ClaudeQueueView {
  const lines = [...screen]
  // Orca removes the composer text from tail and publishes it separately, even
  // when Claude paints a queue hint as a placeholder in that composer.
  if (typeof draft === 'string' && (QUEUE_HINT.test(draft) || SELECTED_HINT.test(draft))) {
    const input = lines.findLastIndex((line) => /^\s*❯\s*$/.test(line))
    if (input !== -1) {
      lines[input] = `❯ ${draft}`
    }
  }
  // Either footer can wrap on a narrow phone-sized terminal.
  const window = (index: number) =>
    lines
      .slice(index, index + 3)
      .map((part) => part.trim())
      .join(' ')
  const footer = lines.findLastIndex(
    (line, index) =>
      (/^\s*[❯›>]?\s*Press up to\b/i.test(line) && QUEUE_HINT.test(window(index))) ||
      (/^\s*[❯›>]?\s*Press Enter\b/i.test(line) && SELECTED_HINT.test(window(index)))
  )
  if (footer === -1) {
    return EMPTY_VIEW
  }
  const hint = window(footer)
  const selecting = SELECTED_HINT.test(hint)
  const selectable = selecting || /select a queued message/i.test(hint)
  const block: string[] = []
  let seenEntry = false
  for (let i = footer - 1; i >= Math.max(0, footer - 60); i--) {
    const line = lines[i]!
    if (!seenEntry && /^\s{8,}Ctrl\+Y to paste deleted text\s*$/.test(line)) {
      continue
    }
    if (/^[\s─━—-]*$/.test(line)) {
      if (seenEntry) {
        break
      }
      continue
    }
    // Claude indents a queue row two spaces and draws a transcript message at
    // column zero with the same marker. A column-zero message's wrapped lines
    // are indented like a queue continuation, so a scan that accepts either
    // walks off the top of the queue and glues transcript text onto an entry.
    if (/^[❯›>]\s/.test(line)) {
      break
    }
    if (/^\s+[❯›>]\s+\S/.test(line)) {
      seenEntry = true
    } else if (!/^\s{2,}\S/.test(line)) {
      break
    }
    block.unshift(line)
  }
  // While an entry is selected Claude drops the marker from every other row,
  // leaving them at the same four-space indent as a wrapped continuation line.
  // The two are then indistinguishable, so refuse to split the block at all;
  // only the single marked row can still be read with confidence.
  if (selecting) {
    const marked = block.map((line) => /^\s+[❯›>]\s+(.+)$/.exec(line)?.[1]?.trim()).filter(Boolean)
    return {
      entries: [],
      selectable,
      selecting: true,
      selected: marked.length === 1 ? marked[0]! : null,
      selectedOldest: /up again for history/i.test(hint)
    }
  }
  const entries: string[] = []
  for (const line of block) {
    const match = /^\s+[❯›>]\s+(.+)$/.exec(line)
    if (match) {
      entries.push(match[1]!.trim())
    } else if (entries.length) {
      entries[entries.length - 1] += '\n' + line.trim()
    }
  }
  return { entries, selectable, selecting: false, selected: null, selectedOldest: false }
}

export function queuedMessagesFromScreen(screen: readonly string[], draft?: unknown): string[] {
  return claudeQueueViewFromScreen(screen, draft).entries
}

export function pendingOutsideVisibleQueue<T extends { text: string }>(
  pending: readonly T[],
  queue: readonly string[]
): T[] {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
  const remaining = queue.map(normalize)
  return pending.filter((item) => {
    const index = remaining.indexOf(normalize(item.text))
    if (index === -1) {
      return true
    }
    remaining.splice(index, 1)
    return false
  })
}

/** A photo row shows the caption the phone sent, not the row Claude drew:
 *  the drawn one carries the paste marker or the temp-file path. `caption`
 *  keeps the drawn row, because that is what a recall has to match against. */
export type MobileChatQueueEntry = string | { text: string; images: string[]; caption: string }

/** Show each confirmed queued send once, retaining local photos in the queue. */
export function projectMobileChatQueue<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  queue: readonly string[]
): { pending: T[]; queue: MobileChatQueueEntry[] } {
  const available = pending.filter((item) => item.images?.length)
  const matchedImages = new Set<T>()
  const projected = queue.map((text): MobileChatQueueEntry => {
    if (!splitOrcaPastedImagePaths(text).paths.length && !/\[Image #\d+\]/.test(text)) {
      return text
    }
    const normalized = normalizeNativeChatUserText(text)
    const index = available.findIndex(
      (item) => normalizeNativeChatUserText(item.text) === normalized
    )
    if (index === -1) {
      return text
    }
    const item = available.splice(index, 1)[0]!
    matchedImages.add(item)
    return { text: item.text, images: item.images!, caption: text }
  })
  return {
    pending: pendingOutsideVisibleQueue(
      pending.filter((item) => !matchedImages.has(item)),
      projected.filter((item): item is string => typeof item === 'string')
    ),
    queue: projected
  }
}
