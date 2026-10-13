import { useState, useSyncExternalStore } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Image as ImageIcon } from 'lucide-react-native'
import { isImageRefBlock, isTextBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import {
  TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY
} from '../components/mobile-markdown-prose-scale'
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import { MobileNativeChatAgentImageTile, MobileNativeChatImageThumb } from './MobileNativeChatImageStrip'
import { isAgentImageAlt } from './mobile-native-chat-agent-images'
import { hostImageMissing, subscribeHostImageMissing, type HostImageMissing } from './host-image-refusals'
import { withoutPendingNativeChatVisualDirectiveTail } from '../../../src/shared/native-chat-visual-directive'
import type { MobileNativeChatVisualRender } from './mobile-native-chat-visual-context'
import {
  TEXT_SIZE,
  USER_TEXT_LINE_HEIGHT,
  USER_TEXT_SIZE,
  type ChatMessageStyles
} from './mobile-native-chat-message-styles'

/** One text or image block of a message: a sent prompt as a plain bubble
 *  line, an answer as markdown, an image as a thumbnail or a chip. */
export function Prose({
  block,
  invert,
  markdownPrompt,
  fontScale,
  onOpenFile,
  styles,
  identity,
  renderVisual,
  holdPendingVisual = false
}: {
  block: NativeChatBlock
  invert?: boolean
  /** A prompt the lead agent wrote, not the user: Markdown, in the bubble. */
  markdownPrompt?: boolean
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
  /** Which message block this is, so a recycled row's markdown tells one
   *  message from the next (MobileMarkdown's `identity`). */
  identity?: string
  /** Assistant prose of a structured chat only (Orca #26071). */
  renderVisual?: MobileNativeChatVisualRender
  /** The reply may still be growing: a directive still being typed at its tail is held back. */
  holdPendingVisual?: boolean
}) {
  if (isTextBlock(block)) {
    if (invert && !markdownPrompt) {
      // Not selectable, on purpose: a hold on a sent prompt copies the whole
      // prompt (MobileNativeChatMessage's Bubble, 2026-09-21), and a selectable
      // Text would take that hold for Android's own selection first. The
      // 2026-09-12 complaint — a hold on their own bubble did nothing — is
      // answered by the copy now, not by selection.
      return (
        <Text
          style={[
            styles.userText,
            { fontSize: USER_TEXT_SIZE * fontScale, lineHeight: USER_TEXT_LINE_HEIGHT * fontScale }
          ]}
        >
          {block.text}
        </Text>
      )
    }
    // A bubble (a prompt the lead wrote) never draws visuals; only a reply does.
    const visuals = invert ? undefined : renderVisual
    return (
      <MobileMarkdown
        content={
          holdPendingVisual && visuals
            ? withoutPendingNativeChatVisualDirectiveTail(block.text)
            : block.text
        }
        renderVisual={visuals}
        textScale={fontScale}
        onOpenFile={onOpenFile}
        identity={identity}
        typography={invert ? TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY : TRANSCRIPT_MARKDOWN_TYPOGRAPHY}
        widthKey={invert ? undefined : 'chat-reply'}
      />
    )
  }
  if (isImageRefBlock(block)) {
    // A local preview (composer echo) or real URL renders as a thumbnail; a bare
    // host path (not loadable on the device) falls back to a text placeholder.
    const uri = block.url ?? block.path
    // A picture the agent read or sent: a square tile, as the Claude app
    // draws it, or, until the host sends it (or when it will not), a
    // placeholder naming the file.
    if (!invert && isAgentImageAlt(block.alt)) {
      if (isRenderableImageUri(block.url)) {
        return <MobileNativeChatAgentImageTile uri={block.url} label={block.alt ?? 'Image'} />
      }
      return <AgentImagePlaceholder path={block.path} fontScale={fontScale} styles={styles} />
    }
    // A photo in the user's own bubble: the same 96 dp tile.
    if (invert && isRenderableImageUri(uri)) {
      return <MobileNativeChatAgentImageTile uri={uri} label={block.alt ?? 'Image'} />
    }
    if (isRenderableImageUri(uri)) {
      // Why: the picture is already on the phone (a local upload, or a host
      // thumbnail fetched earlier), so tapping opens it full-screen at once —
      // no host round trip, nothing to fail.
      return <MobileNativeChatImageThumb uri={uri} label={block.alt ?? 'Image'} styles={styles} />
    }
    // Desktop clipboard files have no mobile preview grant, and a `[Image #N]`
    // stand-in names no file at all. A transcript path alone cannot make those
    // bytes available on the phone; don't expose an action that only produces
    // a path error. A real URI above still wins.
    const desktopPaste = isDesktopImageRef(block)
    const hostPath = block.path
    return (
      <Pressable
        onPress={!desktopPaste && hostPath && onOpenFile ? () => onOpenFile(hostPath) : undefined}
        disabled={desktopPaste}
        accessibilityRole={desktopPaste ? 'image' : 'button'}
        accessibilityLabel={
          desktopPaste ? 'Image on Desktop. Preview unavailable.' : (block.alt ?? 'Attached image')
        }
        style={styles.imageChip}
      >
        <ImageIcon size={14} color={styles.imageRef.color as string} strokeWidth={2} />
        <Text style={[styles.imageRef, { fontSize: (TEXT_SIZE - 2) * fontScale }]}>
          {desktopPaste ? 'Image on Desktop' : 'Image'}
        </Text>
      </Pressable>
    )
  }
  return null
}

/** What a placeholder says when tapped. */
function missingPictureNote(why: HostImageMissing | undefined): string {
  switch (why) {
    case 'not-shared':
      return "The desktop didn't share this picture. It shares a file outside the project only when the agent's reply names it or the terminal printed its path."
    case 'failed':
      return "The picture couldn't be fetched from the desktop."
    case undefined:
      return 'Waiting for the desktop to send this picture.'
    default: {
      const unhandled: never = why
      return unhandled
    }
  }
}

/** A picture the host has not sent, or will not. A tap says which, under the
 *  chip, and a second tap folds it away. Opening the path is no use: it asks
 *  the same host the same question. An open note follows the host's latest
 *  answer. */
function AgentImagePlaceholder({
  path,
  fontScale,
  styles
}: {
  path: string | undefined
  fontScale: number
  styles: ChatMessageStyles
}) {
  const [explained, setExplained] = useState(false)
  const why = useSyncExternalStore(subscribeHostImageMissing, () => hostImageMissing(path))
  const name = fileName(path)
  const textStyle = [styles.imageRef, { fontSize: (TEXT_SIZE - 2) * fontScale }]
  return (
    <View style={styles.imagePlaceholder}>
      <Pressable
        onPress={() => setExplained((shown) => !shown)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Image on Desktop: ${name}. Preview unavailable.`}
        accessibilityHint="Says why the picture is not shown"
        accessibilityState={{ expanded: explained }}
        style={({ pressed }) => [styles.imageChip, pressed && styles.controlPressed]}
      >
        <ImageIcon size={14} color={styles.imageRef.color as string} strokeWidth={2} />
        <Text numberOfLines={1} style={[textStyle, { flexShrink: 1 }]}>
          {name}
        </Text>
      </Pressable>
      {explained ? (
        <Text accessibilityLiveRegion="polite" style={textStyle}>
          {missingPictureNote(why)}
        </Text>
      ) : null}
    </View>
  )
}

function fileName(path: string | undefined): string {
  if (!path) {
    return 'Image'
  }
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}
