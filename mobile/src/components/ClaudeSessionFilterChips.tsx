import { ScrollView, View } from 'react-native'
import { CLAUDE_SESSION_FILTERS, type ClaudeSessionFilter, type ClaudeSessionState } from '../session/claude-session-state'
import { useTheme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { Chip } from '../ui/Chip'

/** A state's status dot, in the live theme's tokens (both schemes define each one). */
export function claudeSessionStateColor(state: ClaudeSessionState, colors: ThemeColors): string {
  switch (state) {
    case 'working':
      return colors.warning
    case 'needs-input':
      return colors.danger
    case 'ready-for-review':
      return colors.info
    case 'completed':
      return colors.success
    case 'archived':
      return colors.textMuted
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

/**
 * The Claude app's session filter row (`session_filter_*`, 1.261013.20) over the workspace list,
 * in Code UI's own Chip and sizes. Phone-local: it narrows only what this phone shows, never the
 * desktop's sidebar (claude-session-list-filter.ts says what each filter keeps).
 */
export function ClaudeSessionFilterChips({ value, onChange }: { value: ClaudeSessionFilter; onChange: (next: ClaudeSessionFilter) => void }) {
  const { colors, space } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs + 2, paddingHorizontal: space.lg, paddingVertical: space.xs }}>
      {CLAUDE_SESSION_FILTERS.map((filter) => (
        <Chip
          key={filter.value}
          size="sm"
          label={filter.label}
          selected={filter.value === value}
          onPress={() => onChange(filter.value)}
          leading={
            filter.value === 'all' ? null : (
              <View testID="claude-session-filter-dot" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: claudeSessionStateColor(filter.value, colors) }} />
            )
          }
        />
      ))}
    </ScrollView>
  )
}
