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
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        backgroundColor: colors.bgPanel
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 48,
          paddingLeft: space.md,
          paddingRight: space.xs,
          borderBottomWidth: 1,
          borderBottomColor: colors.border
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="label" weight="medium" tone="secondary">
            Queued
          </Txt>
          <View
            style={{
              minWidth: 22,
              paddingHorizontal: space.xs,
              paddingVertical: 2,
              alignItems: 'center',
              borderRadius: radius.xs,
              backgroundColor: colors.bgRaised
            }}
          >
            <Txt
              variant="caption"
              weight="medium"
              tone="secondary"
              accessibilityLabel={`${messages.length} queued messages`}
            >
              {messages.length}
            </Txt>
          </View>
        </View>
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
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.bgRaised : 'transparent'
            })}
          >
            <Pencil size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={{ maxHeight: 220 }}
        contentContainerStyle={{ paddingHorizontal: space.md }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
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
                gap: space.sm,
                paddingVertical: space.md,
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: colors.border
              }}
            >
              <Txt
                variant="caption"
                tone="muted"
                accessibilityLabel={`Message ${index + 1}`}
                style={{ minWidth: 16, paddingTop: 3 }}
              >
                {index + 1}
              </Txt>
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
