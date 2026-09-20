import { FlatList, Pressable, View, type LayoutChangeEvent } from 'react-native'
import {
  composerSuggestionInsertText,
  composerSuggestionKey,
  type ComposerSuggestion
} from './composer-suggestion-text'
import { useTheme } from '../theme/theme-context'
import { SUGGESTION_POPOVER_CAP, SUGGESTION_ROW_HEIGHT } from './mobile-native-chat-suggestion-popover'
import { Txt } from '../ui/Txt'

/** A provider's argument sketch for a command (`<objective>`), shown beside the
 *  token so the row says how the command is invoked, not just what it does
 *  (Orca #19928). Capped so a provider cannot swamp the row. */
const ARGUMENT_HINT_MAX_LENGTH = 80

export function suggestionArgumentHint(suggestion: ComposerSuggestion): string | null {
  if (suggestion.kind !== 'command' || !suggestion.command.argumentHint) {
    return null
  }
  const hint = suggestion.command.argumentHint.replace(/\s+/g, ' ').trim()
  return hint ? hint.slice(0, ARGUMENT_HINT_MAX_LENGTH) : null
}



export { composerSuggestionInsertText, composerSuggestionKey, type ComposerSuggestion } from './composer-suggestion-text'

export function MobileNativeChatComposerSuggestions({
  suggestions,
  onPick,
  maxHeight = SUGGESTION_POPOVER_CAP,
  onLayout
}: {
  suggestions: readonly ComposerSuggestion[]
  onPick: (suggestion: ComposerSuggestion) => void
  /** From the composer: the room between the header and the dock, keyboard
   *  included (mobile-native-chat-suggestion-popover.ts). */
  maxHeight?: number
  /** The popover's laid-out height, so the composer can tell the dock apart from it. */
  onLayout?: (event: LayoutChangeEvent) => void
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  return (
    <View
      style={{
        marginHorizontal: space.md,
        marginBottom: space.xs,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgPanel,
        overflow: 'hidden'
      }}
      testID="composer-suggestions"
      onLayout={onLayout}
    >
      <FlatList
        data={suggestions}
        keyExtractor={composerSuggestionKey}
        keyboardShouldPersistTaps="always"
        // Why a measured cap: the dock is absolutely positioned at the bottom
        // and this list sits inside it, so a fixed height grew the dock up
        // under the tab strip with the keyboard open (2026-09-20).
        style={{ maxHeight }}
        initialNumToRender={14}
        windowSize={5}
        // Rows are one fixed height, so the list needs no measuring pass and
        // a keystroke that changes the list costs one layout, not two hundred.
        getItemLayout={(_, index) => ({
          length: SUGGESTION_ROW_HEIGHT,
          offset: SUGGESTION_ROW_HEIGHT * index,
          index
        })}
        removeClippedSubviews
        // One line per row, the token and nothing else — the Claude app's
        // menu, which the user asked for over the catalog description and the
        // source badge each row carried (2026-09-20). The description is still
        // what `suggestionDescription` returns for anything that wants it.
        renderItem={({ item: suggestion }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={composerSuggestionInsertText(suggestion)}
            style={({ pressed }) => ({
              height: SUGGESTION_ROW_HEIGHT,
              paddingHorizontal: space.md,
              justifyContent: 'center',
              backgroundColor: pressed ? colors.bgRaised : 'transparent'
            })}
            onPress={() => onPick(suggestion)}
          >
            <Txt variant="body" tone="accent" numberOfLines={1}>
              {composerSuggestionInsertText(suggestion)}
            </Txt>
          </Pressable>
        )}
      />
    </View>
  )
}
