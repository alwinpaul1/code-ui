import { FlatList, Pressable, View, type LayoutChangeEvent } from 'react-native'
import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { nativeChatSkillCommandName } from './mobile-native-chat-skill-command'
import { formatNativeChatFileMentionToken } from './mobile-native-chat-file-mention'
import { useTheme } from '../theme/theme-context'
import { SUGGESTION_POPOVER_CAP, SUGGESTION_ROW_HEIGHT } from './mobile-native-chat-suggestion-popover'
import { Txt } from '../ui/Txt'

/** One row of the composer autocomplete: an agent slash command (with its
 *  catalog description, desktop parity) or a worktree file path. */
export type ComposerSuggestion =
  | { kind: 'command'; command: SlashCommandSuggestion }
  | { kind: 'file'; path: string }
  /** An installed skill or plugin command; `prefix` is the agent's invoke token. */
  | { kind: 'skill'; skill: DiscoveredSkill; prefix: '/' | '$' }

export function composerSuggestionKey(suggestion: ComposerSuggestion): string {
  switch (suggestion.kind) {
    case 'command':
      return `command:${suggestion.command.name}`
    case 'file':
      return `file:${suggestion.path}`
    case 'skill':
      return `skill:${nativeChatSkillCommandName(suggestion.skill)}`
    default: {
      const exhaustive: never = suggestion
      return exhaustive
    }
  }
}

/** The text the suggestion inserts at the trigger span. */
export function composerSuggestionInsertText(suggestion: ComposerSuggestion): string {
  switch (suggestion.kind) {
    case 'command':
      return `/${suggestion.command.name}`
    case 'file':
      return formatNativeChatFileMentionToken(suggestion.path)
    case 'skill':
      return `${suggestion.prefix}${nativeChatSkillCommandName(suggestion.skill)}`
    default: {
      const exhaustive: never = suggestion
      return exhaustive
    }
  }
}

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
