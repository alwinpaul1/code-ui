import { Image, Pressable, ScrollView, View } from 'react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import { openImagePreview } from './image-preview-store'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'

export function MobileNativeChatQueue({
  messages
}: {
  messages?: readonly MobileChatQueueEntry[]
}) {
  const { colors, space, radius } = useTheme()
  if (!messages?.length) {
    return null
  }
  return (
    <View
      style={{
        marginHorizontal: space.md,
        marginVertical: space.sm,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: colors.bgPanel
      }}
    >
      <Txt variant="caption" tone="secondary">{`Queued on agent · ${messages.length}`}</Txt>
      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
        {messages.map((entry, index) => {
          const text = typeof entry === 'string' ? entry : entry.text
          const images = typeof entry === 'string' ? [] : entry.images
          const parsed = splitOrcaPastedImagePaths(text)
          return (
            <View key={`${index}:${text}`} style={{ gap: space.sm, marginBottom: space.md }}>
              {parsed.text ? (
                <Txt variant="body" selectable>
                  {parsed.text}
                </Txt>
              ) : null}
              {images.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {images.map((uri, imageIndex) => (
                    <Pressable
                      key={`${imageIndex}:${uri}`}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Preview queued image ${imageIndex + 1}`}
                      onPress={() => openImagePreview(uri, 'Queued image')}
                    >
                      <Image
                        source={{ uri }}
                        resizeMode="contain"
                        style={{ width: 72, height: 72, borderRadius: radius.sm }}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : parsed.paths.length ? (
                <Txt
                  variant="caption"
                  tone="secondary"
                >{`${parsed.paths.length} attached image${parsed.paths.length === 1 ? '' : 's'}`}</Txt>
              ) : null}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
