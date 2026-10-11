import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatImageRefBlock,
  type NativeChatMessage,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { toolCallKind } from './mobile-native-chat-tool-kind'

/**
 * The pictures an agent's turn shows outside its tool group, the way the
 * Claude app draws them (the user's screenshots of 2026-10-11, Claude Code
 * 2.1.296):
 *   - a Read of an image: the picture right after the tool run that read it;
 *   - SendUserFile: its caption as a line of text, then each file it sent (a
 *     picture as a thumbnail, anything else as a file card), in the call's own
 *     place, and NOT counted in the group's sentence as "used a tool".
 *
 * Neither picture's bytes reach the phone. The transcript holds the Read's as
 * a base64 `image` block, and Orca 1.4.224's reader drops it (it keeps an
 * image only when its source is a URL); SendUserFile records only the path and
 * the `file_uuid` the Claude app downloads it by. So each picture is asked of
 * the host by its path (use-host-image-previews.ts) and drawn when it comes;
 * until then, or when the host will not share it, the slot is a placeholder
 * that names the file (MobileNativeChatProse.tsx).
 */

export const AGENT_READ_IMAGE_ALT = 'Image the agent read'
export const AGENT_SENT_IMAGE_ALT = 'Image the agent sent'
/** A text block whose text is the path of a non-image file SendUserFile sent:
 *  drawn as a file card (mobile-native-chat-prose-groups.ts). */
export const SENT_FILE_PRESENTATION = 'sent-file'

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i

export function isImageFilePath(path: string): boolean {
  return IMAGE_FILE.test(path)
}

export function isAgentImageAlt(alt: string | undefined): boolean {
  return alt === AGENT_READ_IMAGE_ALT || alt === AGENT_SENT_IMAGE_ALT
}

export type SentFiles = {
  files: string[]
  caption: string
  /** `render` (inline) or `attach` (a card), as Claude Code 2.1.2xx records it. */
  display?: string
}

/** A SendUserFile call's files and caption, or null when the input is not
 *  the shape every recorded call has (2.1.210 to 2.1.296: `files` an array
 *  of path strings, `caption` a string). Not that shape, it stays the tool
 *  row it was: refusing beats guessing at a shape nobody has seen. */
export function readSentFiles(block: NativeChatBlock): SentFiles | null {
  if (!isToolCallBlock(block) || block.name !== 'SendUserFile') {
    return null
  }
  const input = block.input as { files?: unknown; caption?: unknown; display?: unknown } | null
  if (!input || typeof input !== 'object' || !Array.isArray(input.files)) {
    return null
  }
  if (!input.files.every((file): file is string => typeof file === 'string' && file.length > 0)) {
    return null
  }
  return {
    files: input.files,
    caption: typeof input.caption === 'string' ? input.caption.trim() : '',
    ...(typeof input.display === 'string' ? { display: input.display } : {})
  }
}

/** The files a SendUserFile call sent that are drawn as pictures. */
export function sentImagePaths(sent: SentFiles): string[] {
  return sent.display === 'attach' ? [] : sent.files.filter(isImageFilePath)
}

function readImagePath(block: NativeChatToolCallBlock): string | null {
  if (toolCallKind(block.name) !== 'read') {
    return null
  }
  const input = block.input as { file_path?: unknown; path?: unknown } | null
  const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : null
  return path && isImageFilePath(path) ? path : null
}

/** Every picture a message's calls show, in the order the calls were made:
 *  the one each image Read named, and each picture a SendUserFile sent. The
 *  previews the host sends back are in this order (placeAgentImages). */
export function agentImagePaths(message: NativeChatMessage): string[] {
  const paths: string[] = []
  for (const block of message.blocks) {
    if (!isToolCallBlock(block)) {
      continue
    }
    const sent = readSentFiles(block)
    if (sent) {
      paths.push(...sentImagePaths(sent))
      continue
    }
    const read = readImagePath(block)
    if (read) {
      paths.push(read)
    }
  }
  return paths
}

function imageRef(path: string, uri: string | undefined, alt: string): NativeChatImageRefBlock {
  return { type: 'image-ref', path, ...(uri ? { url: uri } : {}), alt }
}

/**
 * A turn's blocks with its pictures put where the Claude app puts them, and
 * each SendUserFile call and its result taken out of the tool run.
 *
 * `previews` holds the picture URIs in `agentImagePaths` order; an empty or
 * missing one leaves that slot a placeholder (path, no URL). A message with
 * no image Read and no readable SendUserFile comes back as it was.
 */
export function placeAgentImages(
  blocks: readonly NativeChatBlock[],
  previews: readonly string[] | undefined
): NativeChatBlock[] {
  const sentResults = new Set<NativeChatBlock>()
  let any = false
  for (const { call, result } of pairToolBlocks(blocks)) {
    if (call && readSentFiles(call)) {
      any = true
      if (result) {
        sentResults.add(result)
      }
    } else if (call && readImagePath(call)) {
      any = true
    }
  }
  if (!any) {
    return blocks as NativeChatBlock[]
  }
  const out: NativeChatBlock[] = []
  let waiting: NativeChatBlock[] = []
  let next = 0
  const take = (): string | undefined => {
    const uri = previews?.[next]
    next += 1
    return uri || undefined
  }
  const flush = () => {
    out.push(...waiting)
    waiting = []
  }
  for (const block of blocks) {
    if (sentResults.has(block)) {
      continue
    }
    const sent = readSentFiles(block)
    if (sent) {
      // The call ends the run before it: the pictures read there go first.
      flush()
      if (sent.caption) {
        out.push({ type: 'text', text: sent.caption })
      }
      const pictures = new Set(sentImagePaths(sent))
      for (const file of sent.files) {
        out.push(
          pictures.has(file)
            ? imageRef(file, take(), AGENT_SENT_IMAGE_ALT)
            : { type: 'text', text: file, presentation: SENT_FILE_PRESENTATION }
        )
      }
      continue
    }
    if (isToolCallBlock(block)) {
      out.push(block)
      const read = readImagePath(block)
      if (read) {
        waiting.push(imageRef(read, take(), AGENT_READ_IMAGE_ALT))
      }
      continue
    }
    if (isToolResultBlock(block)) {
      out.push(block)
      continue
    }
    flush()
    out.push(block)
  }
  flush()
  return out
}
