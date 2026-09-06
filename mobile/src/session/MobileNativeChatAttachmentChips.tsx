import { FileText, X } from 'lucide-react-native'
import { Image, Pressable, ScrollView, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { openImagePreview } from './image-preview-store'

/** The strip above the composer text: image thumbnails and named document
 *  chips, each with its remove badge. */
export function MobileNativeChatAttachmentChips({
  attachments,
  onRemoveAttachment
}: {
  attachments: readonly PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
}) {
  const { colors, radius, space } = useTheme()
  if (attachments.length === 0) {
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
              // Why: the picture is already on the phone, so a tap opens it
              // full-screen at once, same as a thumbnail in a sent bubble.
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="Preview image"
                style={{ flex: 1 }}
                onPress={() => openImagePreview(attachment.previewUri, attachment.name ?? 'Image')}
              >
                <Image
                  source={{ uri: attachment.previewUri }}
                  style={{ width: '100%', height: '100%', borderRadius: radius.sm }}
                  resizeMode="cover"
                />
              </Pressable>
            )}
            {onRemoveAttachment ? (
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
