import { Image, Pressable, ScrollView, View } from 'react-native'
import { Pencil } from 'lucide-react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import { openImagePreview } from './image-preview-store'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'

export function MobileNativeChatQueue({
  messages,
  agent,
  onEdit
}: {
  messages?: readonly MobileChatQueueEntry[]
  agent?: string | null
  onEdit?: () => Promise<void>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="secondary">{`Queued on agent · ${messages.length}`}</Txt>
        {onEdit && (agent === 'claude' || agent === 'codex') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              agent === 'codex'
                ? 'Edit latest queued message in Codex'
                : 'Edit queued messages in Claude'
            }
            onPress={() => void onEdit()}
            style={({ pressed }) => ({
              minHeight: 44,
              minWidth: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space.xs,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.border : colors.bgRaised
            })}
          >
            <Pencil size={16} color={colors.textSecondary} />
            <Txt variant="caption" tone="secondary">
              {agent === 'codex' ? 'Edit latest' : 'Edit queue'}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
        {messages.map((entry, index) => {
          const text = typeof entry === 'string' ? entry : entry.text
          const images = typeof entry === 'string' ? [] : entry.images
          const parsed = splitOrcaPastedImagePaths(text)
          return (
            <View
              key={`${index}:${text}`}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: space.md,
                paddingVertical: space.sm,
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: colors.border
              }}
            >
              {images.length ? (
                <View style={{ width: 48, gap: space.xs }}>
                  {images.map((uri, imageIndex) => (
                    <Pressable
                      key={`${imageIndex}:${uri}`}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Preview image ${imageIndex + 1} in queued message ${index + 1}`}
                      onPress={() => openImagePreview(uri, 'Queued image')}
                    >
                      <Image
                        source={{ uri }}
                        resizeMode="contain"
                        style={{ width: 48, height: 48, borderRadius: radius.sm }}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={{ flex: 1, gap: space.xs }}>
                <Txt variant="caption" tone="secondary">{`Message ${index + 1}`}</Txt>
                {parsed.text ? (
                  <Txt variant="body" selectable>
                    {parsed.text}
                  </Txt>
                ) : null}
                {!images.length && parsed.paths.length ? (
                  <Txt variant="caption" tone="secondary">
                    {`${parsed.paths.length} attached image${parsed.paths.length === 1 ? '' : 's'}`}
                  </Txt>
                ) : null}
              </View>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
