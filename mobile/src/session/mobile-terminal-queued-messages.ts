import { normalizeNativeChatUserText } from './mobile-native-chat-image-transcript-markers'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
/** Read only the explicit Claude queue block immediately above its queue footer.
 * The screen can show only a subset of a long queue; never use this to rewrite it. */
export function queuedMessagesFromScreen(lines: readonly string[]): string[] {
  const footer = lines.findLastIndex((line) => /Press up to edit queued messages/i.test(line))
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

/** Keep the photo bubble when a TUI queue echoes its caption plus image paths.
 * Text-only queue entries still use the agent queue. Match each occurrence once. */
export function projectMobileChatQueue<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  queue: readonly string[]
): { pending: T[]; queue: string[] } {
  const available = pending.filter((item) => item.images?.length)
  const matchedImages = new Set<T>()
  const remainingQueue = queue.filter((text) => {
    if (!splitOrcaPastedImagePaths(text).paths.length && !/\[Image #\d+\]/.test(text)) {
      return true
    }
    const normalized = normalizeNativeChatUserText(text)
    const index = available.findIndex(
      (item) => normalizeNativeChatUserText(item.text) === normalized
    )
    if (index === -1) {
      return true
    }
    matchedImages.add(available.splice(index, 1)[0]!)
    return false
  })
  const unmatched = new Set(
    pendingOutsideVisibleQueue(
      pending.filter((item) => !matchedImages.has(item)),
      remainingQueue
    )
  )
  return {
    pending: pending.filter((item) => matchedImages.has(item) || unmatched.has(item)),
    queue: remainingQueue
  }
}
