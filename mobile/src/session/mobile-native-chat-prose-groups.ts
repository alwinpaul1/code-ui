import { isImageRefBlock, isTextBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { parseFileMentionText, sentFileCard, type FileMentionCard } from './mobile-native-chat-file-mentions'
import { SENT_FILE_PRESENTATION } from './mobile-native-chat-agent-images'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'

export type ProseGroup =
  | { type: 'block'; block: NativeChatBlock }
  | { type: 'image-strip'; uris: string[]; alt: string }
  | { type: 'file-cards'; cards: FileMentionCard[]; sent?: true }

/** Fold a run of two or more loadable images into one sideways-scrolling
 *  strip, the way the Claude app lays out a multi-image upload (2026-09-12).
 *  A lone image, a text block, or an image the phone cannot load stays its
 *  own block, so the placeholder chip and single thumbnail are unchanged.
 *
 *  `isUser` scopes file-mention detection to the user's own turn: the
 *  `@"<path>"` marker is Claude Code's record of what the user attached
 *  (docs/claude-app-parity.md item 9), and an agent's reply is free to quote
 *  an unrelated path in the same shape. */
export function groupProseBlocks(
  blocks: NativeChatBlock[],
  options?: { isUser?: boolean }
): ProseGroup[] {
  const groups: ProseGroup[] = []
  for (const block of blocks) {
    if (options?.isUser && isTextBlock(block)) {
      const { cards, caption } = parseFileMentionText(block.text)
      if (cards.length > 0) {
        groups.push({ type: 'file-cards', cards })
        if (caption) {
          groups.push({ type: 'block', block: { ...block, text: caption } })
        }
        continue
      }
    }
    const last = groups[groups.length - 1]
    // A file the agent sent with SendUserFile (mobile-native-chat-agent-images.ts).
    if (isTextBlock(block) && block.presentation === SENT_FILE_PRESENTATION) {
      if (last?.type === 'file-cards' && last.sent) {
        last.cards.push(sentFileCard(block.text))
      } else {
        groups.push({ type: 'file-cards', cards: [sentFileCard(block.text)], sent: true })
      }
      continue
    }
    const uri = isImageRefBlock(block) ? (block.url ?? block.path) : undefined
    if (uri && isRenderableImageUri(uri)) {
      if (last?.type === 'image-strip') {
        last.uris.push(uri)
        continue
      }
      if (last?.type === 'block' && renderableImageUri(last.block)) {
        groups[groups.length - 1] = {
          type: 'image-strip',
          uris: [renderableImageUri(last.block) as string, uri],
          alt: last.block.type === 'image-ref' ? (last.block.alt ?? 'Image') : 'Image'
        }
        continue
      }
    }
    groups.push({ type: 'block', block })
  }
  return groups
}

function renderableImageUri(block: NativeChatBlock): string | undefined {
  if (!isImageRefBlock(block)) {
    return undefined
  }
  const uri = block.url ?? block.path
  return uri && isRenderableImageUri(uri) ? uri : undefined
}

/** Any picture group: a strip, or one picture block, loaded or drawn as its
 *  "Image on Desktop" chip. */
function isPictureGroup(group: ProseGroup | undefined): boolean {
  return group?.type === 'image-strip' || (group?.type === 'block' && isImageRefBlock(group.block))
}

/** Whether the group at `index` is a picture with text right after it. */
export function imageLeadsText(groups: readonly ProseGroup[], index: number): boolean {
  const next = groups[index + 1]
  if (!next || next.type !== 'block' || isImageRefBlock(next.block)) {
    return false
  }
  // The chip sat flush on the text under it (2026-10-11).
  return isPictureGroup(groups[index])
}

/** Whether the group at `index` is a picture right under another picture.
 *  Two loaded tiles share a strip; a placeholder chip never joins one, so
 *  two chips, or a chip and a tile, stood one on the other with no space
 *  between them (2026-10-13). */
export function imageFollowsImage(groups: readonly ProseGroup[], index: number): boolean {
  return index > 0 && isPictureGroup(groups[index]) && isPictureGroup(groups[index - 1])
}
