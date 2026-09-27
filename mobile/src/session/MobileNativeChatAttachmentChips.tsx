import { FileText, Film, X } from 'lucide-react-native'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import type { VideoFrameExtractionProgress } from './mobile-video-frame-extractor'
import { openImagePreview } from './image-preview-store'

/** The strip above the composer text: image thumbnails and named document
 *  chips, each with its remove badge, plus (while a document attach is
 *  reading an over-the-cap video) one progress chip ahead of them all. */
export function MobileNativeChatAttachmentChips({
  attachments,
  onRemoveAttachment,
  onEditAttachment,
  videoFrameExtraction,
  onCancelVideoFrameExtraction
}: {
  attachments: readonly PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  /** Opens the markup editor on a photo chip, from the pencil in the
   *  full-screen preview a tap on the photo opens. The chip itself carries no
   *  pencil (2026-09-24). Never used for a document chip, which has nothing
   *  to draw on. */
  onEditAttachment?: (id: string, uri: string) => void
  /** An over-the-cap video's frames are still being read — "Reading frames
   *  5/20…", cancellable. Not one of `attachments`: it is drawn beside them
   *  so it can never be mistaken for a chip a send is waiting on
   *  (`mobile-native-chat-image-attachments-store.ts`). */
  videoFrameExtraction?: VideoFrameExtractionProgress | null
  onCancelVideoFrameExtraction?: () => void
}) {
  const { colors, radius, space } = useTheme()
  if (attachments.length === 0 && !videoFrameExtraction) {
    return null
  }
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={{ maxHeight: 80 }}
      contentContainerStyle={{
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingTop: space.md
      }}
    >
      {videoFrameExtraction ? (
        <View
          style={{
            height: 60,
            maxWidth: 210,
            paddingRight: 26,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgRaised
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              paddingLeft: space.sm
            }}
          >
            <Film size={20} color={colors.textSecondary} strokeWidth={1.8} />
            <Txt variant="caption" weight="medium" numberOfLines={2} style={{ maxWidth: 140 }}>
              {`Reading frames ${videoFrameExtraction.done}/${videoFrameExtraction.total}…`}
            </Txt>
          </View>
          {onCancelVideoFrameExtraction ? (
            <Pressable
              accessibilityLabel="Cancel reading frames"
              style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.text
              }}
              onPress={onCancelVideoFrameExtraction}
              hitSlop={8}
            >
              <X size={12} color={colors.textInverse} strokeWidth={2.6} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {attachments.map((attachment) => {
        const isFile = attachment.kind === 'file'
        return (
          <View
            key={attachment.id}
            style={{
              height: 60,
              ...(isFile ? { maxWidth: 210, paddingRight: 26 } : { width: 60 }),
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bgRaised
            }}
          >
            {isFile ? (
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.xs,
                  paddingLeft: space.sm
                }}
              >
                <FileText size={20} color={colors.textSecondary} strokeWidth={1.8} />
                <Txt variant="caption" weight="medium" numberOfLines={2} style={{ maxWidth: 140 }}>
                  {attachment.name ?? 'File'}
                </Txt>
              </View>
            ) : (
              // A tap opens the photo full-screen, the way the Claude app does,
              // and markup is the pencil there (2026-09-26; from 360ef269 a tap
              // went straight into markup). No pencil while an upload has not
              // settled, or with no editor to hand.
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="Preview image"
                style={{ flex: 1 }}
                onPress={() =>
                  openImagePreview(
                    attachment.previewUri,
                    attachment.name ?? 'Image',
                    0,
                    onEditAttachment && !attachment.uploading
                      ? () => onEditAttachment(attachment.id, attachment.previewUri)
                      : undefined
                  )
                }
              >
                <Image
                  source={{ uri: attachment.previewUri }}
                  style={{ width: '100%', height: '100%', borderRadius: radius.sm }}
                  resizeMode="cover"
                />
              </Pressable>
            )}
            {attachment.uploading ? (
              // Still on its way to the host: the chip is there at once, with a
              // ring over it, the way the Claude app shows a heavy upload
              // (2026-09-13). The rest of the composer stays usable.
              <View
                pointerEvents="none"
                accessibilityLabel="Uploading"
                testID="attachment-uploading"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: colors.bgOverlay
                }}
              >
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : null}
            {onRemoveAttachment && !attachment.uploading ? (
              <Pressable
                accessibilityLabel={isFile ? 'Remove file' : 'Remove image'}
                // Inset inside the chip: Android drops touches outside the parent's
                // bounds, so an overhanging badge would lose part of its tap target.
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.text
                }}
                onPress={() => onRemoveAttachment(attachment.id)}
                hitSlop={8}
              >
                <X size={12} color={colors.textInverse} strokeWidth={2.6} />
              </Pressable>
            ) : null}
          </View>
        )
      })}
    </ScrollView>
  )
}
