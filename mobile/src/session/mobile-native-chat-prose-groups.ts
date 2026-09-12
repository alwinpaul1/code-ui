import { isImageRefBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'

export type ProseGroup =
  | { type: 'block'; block: NativeChatBlock }
  | { type: 'image-strip'; uris: string[]; alt: string }

/** Fold a run of two or more loadable images into one sideways-scrolling
 *  strip, the way the Claude app lays out a multi-image upload (2026-09-12).
 *  A lone image, a text block, or an image the phone cannot load stays its
 *  own block, so the placeholder chip and single thumbnail are unchanged. */
export function groupProseBlocks(blocks: NativeChatBlock[]): ProseGroup[] {
  const groups: ProseGroup[] = []
  for (const block of blocks) {
    const uri = isImageRefBlock(block) ? (block.url ?? block.path) : undefined
    const last = groups[groups.length - 1]
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
