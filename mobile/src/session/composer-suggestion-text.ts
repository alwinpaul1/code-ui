import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { nativeChatSkillCommandName } from './mobile-native-chat-skill-command'
import { formatNativeChatFileMentionToken } from './mobile-native-chat-file-mention'

// The composer autocomplete's rows and the text each inserts, in a module
// with no React Native import, so the catalog and its tests can read them.

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

