import { Pressable, View } from 'react-native'
import { X } from 'lucide-react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'

/** The app's `ccr_queued_message_dismiss`. */
export const QUEUED_MESSAGE_EDIT_LABEL = 'Edit queued message'

/**
 * The message queued while Claude works, on a Claude tab that sends through Anthropic
 * (use-ccr-composer-send.ts), drawn as the Claude Android app 1.261009.20 draws it (`hb20.e`):
 * 20 dp above, 80% of the width, aligned like a user message, a 12 dp radius on fill `pl7.s`,
 * 12 dp padding, the words at 15 sp italic in the muted `pl7.Q`, and a 14 dp "x" at the top end
 * ("Edit queued message"). A tap anywhere moves the words back into the composer and empties the
 * queue; there is no separate delete.
 *
 * `pl7.s` (#F0EFEC light, #0D0D0D dark) is the theme's `codeBlockHeader` and `pl7.Q` (#7B7974,
 * #97958D) its `composerPlaceholder`: the same app tokens, read from the theme so Light, Dark and
 * System all follow it. No literal colour here.
 */
export function MobileNativeChatLocalQueue({ text, onEdit }: { text: string | null; onEdit: () => void }): React.JSX.Element | null {
  const { colors } = useTheme()
  if (!text) {
    return null
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={QUEUED_MESSAGE_EDIT_LABEL}
      accessibilityHint="Moves it back into the message box"
      onPress={onEdit}
      testID="ccr-queued-message"
      style={{
        alignSelf: 'flex-end',
        width: '80%',
        marginTop: 20,
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors.codeBlockHeader,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8
      }}
    >
      <Txt variant="body" style={{ flex: 1, fontStyle: 'italic', color: colors.composerPlaceholder }}>
        {text}
      </Txt>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <X size={14} color={colors.composerPlaceholder} />
      </View>
    </Pressable>
  )
}
