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
 * the host by its path (use-host-image-previews.ts), once its slot is on
 * screen, and drawn when it comes; until then the slot is a loading tile of
 * the picture's size, and when the host will not share it, a chip that names
 * the file (MobileNativeChatProse.tsx).
 */

export const AGENT_READ_IMAGE_ALT = 'Image the agent read'
export const AGENT_SENT_IMAGE_ALT = 'Image the agent sent'
/** A screenshot whose picture rode only as base64 in its tool result: no file
 *  exists to ask the host for, so its slot is a note and never fills. */
export const AGENT_UNSAVED_SCREENSHOT_ALT = 'Screenshot the agent took'
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

const CHROME_DEVTOOLS_SCREENSHOT = /chrome-devtools__take_screenshot$/

/** A screenshot call that saved no file: claude-in-chrome `computer` with
 *  action `screenshot` or `zoom`, or chrome-devtools take_screenshot without
 *  a `filePath`. Their results carry the picture only as a base64 `image`
 *  item (Claude Code 2.1.226 to 2.1.296 on this machine), which Orca's reader
 *  drops, and no rule of the desktop can share a file that never existed. */
function isUnsavedScreenshot(block: NativeChatBlock): boolean {
  if (!isToolCallBlock(block)) {
    return false
  }
  const input = block.input as { action?: unknown; filePath?: unknown } | null
  if (block.name === 'mcp__claude-in-chrome__computer') {
    return input?.action === 'screenshot' || input?.action === 'zoom'
  }
  return CHROME_DEVTOOLS_SCREENSHOT.test(block.name) && typeof input?.filePath !== 'string'
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

/** The `toolu_…` call id behind each of `agentImagePaths`, in the same order:
 *  a Read's own id, and none for a picture SendUserFile sent (its bytes are
 *  not in any tool result). use-host-image-previews.ts fills a slot the
 *  desktop left empty from Anthropic's copy of the session by this id. */
export function agentImageCallIds(message: NativeChatMessage): (string | undefined)[] {
  const ids: (string | undefined)[] = []
  for (const block of message.blocks) {
    if (!isToolCallBlock(block)) {
      continue
    }
    const sent = readSentFiles(block)
    if (sent) {
      ids.push(...sentImagePaths(sent).map(() => undefined))
      continue
    }
    if (readImagePath(block)) {
      ids.push(block.callId)
    }
  }
  return ids
}

function imageRef(path: string, uri: string | undefined, alt: string): NativeChatImageRefBlock {
  return { type: 'image-ref', path, ...(uri ? { url: uri } : {}), alt }
}

/**
 * A turn's blocks with its pictures put where the Claude app puts them, and
 * each SendUserFile call and its result taken out of the tool run.
 *
 * `previews` holds the picture URIs in `agentImagePaths` order; an empty one
 * leaves that slot a placeholder (path, no URL). With no `previews` at all
 * (the host was never asked) no slot is drawn, except an unsaved
 * screenshot's note, which never waits on the host. A file read twice in one run
 * (between two blocks of text) has one slot. A message with no image Read
 * and no readable SendUserFile comes back as it was.
 */
export function placeAgentImages(
  blocks: readonly NativeChatBlock[],
  previews: readonly string[] | undefined
): NativeChatBlock[] {
  const sentResults = new Set<NativeChatBlock>()
  // A call whose result is an error showed nothing: a failed send stays the
  // tool row with its error, a failed Read gets no slot. Its pictures were
  // still asked of the host (agentImagePaths sees one record at a time, and
  // the result is another record), so their previews are skipped here, not
  // left out of the count, and every later picture keeps its own.
  const failed = new Set<NativeChatBlock>()
  let any = false
  for (const { call, result } of pairToolBlocks(blocks)) {
    if (call && result?.isError && (readSentFiles(call) || readImagePath(call) || isUnsavedScreenshot(call))) {
      any = true
      failed.add(call)
    } else if (call && readSentFiles(call)) {
      any = true
      if (result) {
        sentResults.add(result)
      }
    } else if (call && (readImagePath(call) || isUnsavedScreenshot(call))) {
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
  // No entry at all means nobody asks the host: the fetch is off on the
  // structured lane and while disconnected (use-mobile-native-chat-controller.ts).
  // A placeholder there would never fill, so the slot is not drawn.
  const slot = (path: string, uri: string | undefined, alt: string): NativeChatImageRefBlock[] =>
    previews === undefined ? [] : [imageRef(path, uri, alt)]
  const flush = () => {
    out.push(...waiting)
    waiting = []
  }
  // One slot per file in a run: the Claude app counts repeat reads of one
  // file once, and the agent that read its screenshot, took a new one under
  // the same name and read it again drew two identical chips (2026-10-13).
  // The host is asked by path, so both previews are the same picture; the
  // first one that came fills the slot.
  const placeRead = (path: string, uri: string | undefined) => {
    const index = waiting.findIndex((block) => block.type === 'image-ref' && block.path === path)
    if (index === -1) {
      waiting.push(...slot(path, uri, AGENT_READ_IMAGE_ALT))
      return
    }
    const held = waiting[index] as NativeChatImageRefBlock
    if (!held.url && uri) {
      waiting[index] = imageRef(path, uri, AGENT_READ_IMAGE_ALT)
    }
  }
  for (const block of blocks) {
    if (sentResults.has(block)) {
      continue
    }
    const sent = readSentFiles(block)
    if (sent && failed.has(block)) {
      for (let skipped = sentImagePaths(sent).length; skipped > 0; skipped -= 1) {
        take()
      }
      out.push(block)
      continue
    }
    if (sent) {
      // The call ends the run before it: the pictures read there go first.
      flush()
      if (sent.caption) {
        out.push({ type: 'text', text: sent.caption })
      }
      const pictures = new Set(sentImagePaths(sent))
      for (const file of sent.files) {
        out.push(
          ...(pictures.has(file)
            ? slot(file, take(), AGENT_SENT_IMAGE_ALT)
            : [{ type: 'text', text: file, presentation: SENT_FILE_PRESENTATION } as const])
        )
      }
      continue
    }
    if (isToolCallBlock(block)) {
      out.push(block)
      // Drawn with or without previews: it is a statement, not a wait. One
      // per run, as a run of browser steps can take a screenshot per step.
      if (isUnsavedScreenshot(block) && !failed.has(block) && !waiting.some((held) => held.type === 'image-ref' && held.alt === AGENT_UNSAVED_SCREENSHOT_ALT)) {
        waiting.push({ type: 'image-ref', alt: AGENT_UNSAVED_SCREENSHOT_ALT })
      }
      const read = readImagePath(block)
      if (read) {
        const uri = take()
        if (!failed.has(block)) {
          placeRead(read, uri)
        }
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
