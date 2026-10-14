import {
  isImageRefBlock,
  isTextBlock,
  type NativeChatBlock,
  type NativeChatImageRefBlock
} from '../../../src/shared/native-chat-types'
import { sentFileCard, type FileMentionCard } from './mobile-native-chat-file-mentions'
import { isAgentImageAlt, SENT_FILE_PRESENTATION } from './mobile-native-chat-agent-images'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'

export type ProseGroup =
  | { type: 'block'; block: NativeChatBlock }
  | { type: 'image-strip'; uris: string[]; alt: string }
  /** Two or more pictures an agent read or sent, side by side, while at
   *  least one has not come from the desktop: its tile holds the place. */
  | { type: 'agent-image-row'; slots: NativeChatImageRefBlock[] }
  | { type: 'file-cards'; cards: FileMentionCard[]; sent?: true }

/** Fold a run of two or more loadable images into one sideways-scrolling
 *  strip, the way the Claude app lays out a multi-image upload (2026-09-12).
 *  A lone image, a text block, or an image the phone cannot load stays its
 *  own block, so the placeholder chip and single thumbnail are unchanged.
 *
 *  A prompt's own uploads never reach here: they are taken out of the text
 *  before the bubble is drawn and shown above it (takeUserUploads,
 *  docs/claude-app-parity.md item 9). */
export function groupProseBlocks(blocks: readonly NativeChatBlock[]): ProseGroup[] {
  const groups: ProseGroup[] = []
  for (const block of blocks) {
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
    // An agent's picture still on its way joins its neighbours, so the row
    // does not turn from a column of tiles into a strip when it lands.
    if (isAgentSlot(block)) {
      if (last?.type === 'agent-image-row') {
        last.slots.push(block)
        continue
      }
      const before = last ? agentSlotsOf(last) : null
      if (before && (before.some((slot) => !isRenderableImageUri(slot.url)) || !isRenderableImageUri(block.url))) {
        groups[groups.length - 1] = { type: 'agent-image-row', slots: [...before, block] }
        continue
      }
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

/** A picture an agent read or sent: loaded, or a slot waiting for the host. */
function isAgentSlot(block: NativeChatBlock): block is NativeChatImageRefBlock {
  return isImageRefBlock(block) && isAgentImageAlt(block.alt) && Boolean(block.path || isRenderableImageUri(block.url))
}

/** The agent pictures a group holds, or null when it holds anything else. */
function agentSlotsOf(group: ProseGroup): NativeChatImageRefBlock[] | null {
  if (group.type === 'block') {
    return isAgentSlot(group.block) ? [group.block] : null
  }
  if (group.type === 'image-strip' && isAgentImageAlt(group.alt)) {
    return group.uris.map((url) => ({ type: 'image-ref', url, alt: group.alt }))
  }
  return null
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
  return (
    group?.type === 'image-strip' ||
    group?.type === 'agent-image-row' ||
    (group?.type === 'block' && isImageRefBlock(group.block))
  )
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
