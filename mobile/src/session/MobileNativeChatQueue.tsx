import { ScrollView, View } from 'react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'

export function MobileNativeChatQueue({ messages }: { messages?: readonly string[] }) {
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
      <Txt variant="caption" tone="secondary">
        Queued on agent
      </Txt>
      <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
        {messages.map((text, index) => (
          <Txt
            key={`${index}:${text}`}
            variant="body"
            selectable
            style={{ marginBottom: space.sm }}
          >
            {text}
          </Txt>
        ))}
      </ScrollView>
    </View>
  )
}
