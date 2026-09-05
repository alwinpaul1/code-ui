import { FlatList, Pressable, View } from 'react-native'
import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { nativeChatSkillCommandName } from './mobile-native-chat-skill-command'
import { useTheme } from '../theme/theme-context'
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
      return `@${suggestion.path}`
    case 'skill':
      return `${suggestion.prefix}${nativeChatSkillCommandName(suggestion.skill)}`
    default: {
      const exhaustive: never = suggestion
      return exhaustive
    }
  }
}

function suggestionDescription(suggestion: ComposerSuggestion): string | null {
  if (suggestion.kind === 'command') {
    return suggestion.command.description ?? null
  }
  if (suggestion.kind === 'skill') {
    return suggestion.skill.description
  }
  return null
}

const SOURCE_LABEL: Record<DiscoveredSkill['sourceKind'], string> = {
  repo: 'Project skill',
  home: 'Skill',
  bundled: 'Bundled',
  plugin: 'Plugin'
}

export function MobileNativeChatComposerSuggestions({
  suggestions,
  onPick
}: {
  suggestions: readonly ComposerSuggestion[]
  onPick: (suggestion: ComposerSuggestion) => void
}): React.JSX.Element {
  const { colors, fonts, radius, space } = useTheme()
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
    >
      <FlatList
        data={suggestions}
        keyExtractor={composerSuggestionKey}
        keyboardShouldPersistTaps="always"
        // Why: tall enough to read through a full `/` catalog, short enough to
        // keep the last messages and the composer on screen.
        style={{ maxHeight: 360 }}
        initialNumToRender={14}
        windowSize={5}
        renderItem={({ item: suggestion, index }) => (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: space.md,
              paddingVertical: space.sm + 2,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: colors.border,
              backgroundColor: pressed ? colors.bgRaised : 'transparent',
              gap: 1
            })}
            onPress={() => onPick(suggestion)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Txt
                variant="label"
                numberOfLines={1}
                style={{ fontFamily: fonts.mono, flexShrink: 1 }}
              >
                {composerSuggestionInsertText(suggestion)}
              </Txt>
              {suggestion.kind === 'skill' ? (
                <Txt
                  variant="caption"
                  tone="accent"
                  weight="medium"
                  style={{
                    paddingHorizontal: 6,
                    borderRadius: radius.xs,
                    backgroundColor: colors.accentSoft
                  }}
                >
                  {SOURCE_LABEL[suggestion.skill.sourceKind]}
                </Txt>
              ) : null}
            </View>
            {suggestionDescription(suggestion) ? (
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {suggestionDescription(suggestion)}
              </Txt>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  )
}
