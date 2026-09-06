import { normalizeNativeChatUserText } from './mobile-native-chat-image-transcript-markers'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
/** Read only the explicit Claude queue block immediately above its queue footer.
 * The screen can show only a subset of a long queue; never use this to rewrite it. */
export function queuedMessagesFromScreen(lines: readonly string[]): string[] {
  // Claude's newer per-message selector has different copy from the legacy
  // whole-queue recall. The hint can wrap on a narrow phone-sized terminal.
  const footer = lines.findLastIndex((line, index) =>
    /^\s*[❯›>]?\s*Press up to\b/i.test(line) &&
    /^\s*[❯›>]?\s*Press up to (?:edit queued messages|select a queued message)\b/i.test(
      lines.slice(index, index + 3).map((part) => part.trim()).join(' ')
    )
  )
  if (footer === -1) {
    return []
  }
  const block: string[] = []
  let seenEntry = false
  for (let i = footer - 1; i >= Math.max(0, footer - 60); i--) {
    const line = lines[i]!
    if (/^[\s─━—-]*$/.test(line)) {
      if (seenEntry) {
        break
      }
      continue
    }
    if (/^\s*[❯›>]\s+\S/.test(line)) {
      seenEntry = true
    } else if (!/^\s{2,}\S/.test(line)) {
      break
    }
    block.unshift(line)
  }
  const entries: string[] = []
  for (const line of block) {
    const match = /^\s*[❯›>]\s+(.+)$/.exec(line)
    if (match) {
      entries.push(match[1]!.trim())
    } else if (entries.length) {
      entries[entries.length - 1] += '\n' + line.trim()
    }
  }
  return entries
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

export type MobileChatQueueEntry = string | { text: string; images: string[] }

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
    return { text: item.text, images: item.images! }
  })
  return {
    pending: pendingOutsideVisibleQueue(
      pending.filter((item) => !matchedImages.has(item)),
      projected.filter((item): item is string => typeof item === 'string')
    ),
    queue: projected
  }
}
