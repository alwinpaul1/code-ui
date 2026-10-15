import { Pressable, Text, View } from 'react-native'
import { CornerDownLeft } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import type { CcrPromptSuggestion } from './ccr-prompt-suggestion'

/**
 * The next-prompt suggestion in the empty composer field (ccr-prompt-suggestion.ts): the words in
 * the field's hint ink where the placeholder would be, at most two lines, two spaces and a small
 * accept pill after them, as the Claude app's k730.e draws it; a tap fills the field. It lies over
 * the field in the field's own type and padding, so the words sit where typed ones would.
 */
export function MobileNativeChatPromptSuggestion({
  suggestion,
  onFill,
  pad,
  type
}: {
  suggestion: CcrPromptSuggestion
  onFill: (text: string) => void
  pad: { top: number; bottom: number; side: number }
  type: { fontFamily: string; fontSize: number; lineHeight: number }
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID="composer-prompt-suggestion"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: pad.top, paddingBottom: pad.bottom, paddingHorizontal: pad.side }}
      onPress={() => onFill(suggestion.text)}
      accessibilityRole="button"
      accessibilityLabel={`Suggested next prompt: ${suggestion.text}. Double tap to fill.`}
    >
      <Text numberOfLines={2} style={{ ...type, color: colors.composerPlaceholder }}>
        {suggestion.text}
        {'  '}
        <View
          testID="composer-prompt-suggestion-accept"
          style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.composerPlaceholder, paddingHorizontal: 5, paddingVertical: 1 }}
        >
          <CornerDownLeft size={12} color={colors.composerPlaceholder} strokeWidth={2} />
        </View>
      </Text>
    </Pressable>
  )
}
