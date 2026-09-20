import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * Claude Code wraps a pasted block inside the user message it records:
 * `\n\n<pasted_content id="329c">\nFind me…\n</pasted_content id="329c">\n\n…`
 * (transcript 6116568a…, 2026-09-20). The desktop and the Claude app show the
 * words; the phone showed the tags (device, 2026-09-20). The tags go, the
 * words stay, and the hook's copy of the prompt carries the same tags, so the
 * keys that retire it are read through this too.
 */
const PASTE_TAGS = /[^\S\n]*<\/?pasted_content\b[^>]*>[^\S\n]*\n?/g

export function withoutPasteWrappers(text: string): string {
  if (!text.includes('<pasted_content') && !text.includes('</pasted_content')) {
    return text
  }
  return text.replace(PASTE_TAGS, '').replace(/^\s*\n/, '').trimEnd()
}

/** User rows with their paste tags gone. */
export function withoutPasteWrappersInRows(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  let out: NativeChatMessage[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    let blocks: NativeChatMessage['blocks'] | null = null
    if (message.role === 'user') {
      message.blocks.forEach((block, at) => {
        if (!isTextBlock(block)) {
          return
        }
        const text = withoutPasteWrappers(block.text)
        if (text !== block.text) {
          blocks ??= [...message.blocks]
          blocks[at] = { ...block, text }
        }
      })
    }
    if (blocks) {
      out ??= messages.slice(0, index)
      out.push({ ...message, blocks })
    } else {
      out?.push(message)
    }
  }
  return out ?? (messages as NativeChatMessage[])
}
