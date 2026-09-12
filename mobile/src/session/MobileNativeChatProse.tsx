import { Pressable, Text } from 'react-native'
import { Image as ImageIcon } from 'lucide-react-native'
import { isImageRefBlock, isTextBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useChatTextSelectable } from '../components/chat-text-selectable-context'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import { MobileNativeChatImageThumb } from './MobileNativeChatImageStrip'
import { TEXT_SIZE, type ChatMessageStyles } from './mobile-native-chat-message-styles'

/** One text or image block of a message: a sent prompt as a plain bubble
 *  line, an answer as markdown, an image as a thumbnail or a chip. */
export function Prose({
  block,
  invert,
  fontScale,
  onOpenFile,
  styles
}: {
  block: NativeChatBlock
  invert?: boolean
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const selectable = useChatTextSelectable()
  if (isTextBlock(block)) {
    if (invert) {
      // Why selectable: a prompt the user sent is the text they most often
      // want back (2026-09-12: a long press on their own bubble did nothing
      // while an agent's answer selected). Tap still reveals the copy control.
      return (
        <Text
          selectable={selectable}
          style={[
            styles.userText,
            { fontSize: TEXT_SIZE * fontScale, lineHeight: (TEXT_SIZE + 7) * fontScale }
          ]}
        >
          {block.text}
        </Text>
      )
    }
    return <MobileMarkdown content={block.text} textScale={fontScale} onOpenFile={onOpenFile} />
  }
  if (isImageRefBlock(block)) {
    // A local preview (composer echo) or real URL renders as a thumbnail; a bare
    // host path (not loadable on the device) falls back to a text placeholder.
    const uri = block.url ?? block.path
    if (isRenderableImageUri(uri)) {
      // Why: the picture is already on the phone (a local upload, or a host
      // thumbnail fetched earlier), so tapping opens it full-screen at once —
      // no host round trip, nothing to fail.
      return <MobileNativeChatImageThumb uri={uri} label={block.alt ?? 'Image'} styles={styles} />
    }
    // Desktop clipboard files have no mobile preview grant. A transcript path
    // alone cannot make those bytes available on the phone; don't expose an
    // action that only produces a path error. A real URI above still wins.
    const desktopPaste = splitOrcaPastedImagePaths(uri ?? '').paths.length > 0
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

