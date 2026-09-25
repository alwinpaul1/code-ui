import { Pressable, Text, TextInput, View } from 'react-native'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { AiVaultScope } from '../../../src/shared/ai-vault-types'
import { agentHistoryStyles } from './agent-history-styles'

const SCOPE_TABS: { scope: AiVaultScope; label: string }[] = [
  { scope: 'workspace', label: 'Workspace' },
  { scope: 'project', label: 'Project' },
  { scope: 'all', label: 'All' }
]

/**
 * The scope tabs and the search box over the history list. The same scope narrows both the loaded
 * list and a session search, so one control drives the two.
 */
export function AgentHistoryFilterBar({
  scope,
  onSelectScope,
  query,
  onChangeQuery
}: {
  scope: AiVaultScope
  onSelectScope: (scope: AiVaultScope) => void
  query: string
  onChangeQuery: (query: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(agentHistoryStyles)
  return (
    <>
      <View style={styles.scopeTabs}>
        {SCOPE_TABS.map((tab) => {
          const active = scope === tab.scope
          return (
            <Pressable
              key={tab.scope}
              style={[styles.scopeTab, active && styles.scopeTabActive]}
              onPress={() => onSelectScope(tab.scope)}
            >
              <Text style={[styles.scopeTabText, active && styles.scopeTabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search sessions, repo:, path:"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
    </>
  )
}
