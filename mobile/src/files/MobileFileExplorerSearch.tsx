import { FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { File, Search, X } from 'lucide-react-native'
import { triggerSelection } from '../platform/haptics'
import { colors } from '../theme/mobile-theme'
import { fileExplorerStyles as styles } from './mobile-file-explorer-styles'

/** The explorer's search field, rendered under the title bar. */
export function MobileFileExplorerSearchBar({
  query,
  onChangeQuery
}: {
  query: string
  onChangeQuery: (query: string) => void
}) {
  return (
    <View style={styles.searchRow}>
      <Search size={16} color={colors.textSecondary} strokeWidth={2} />
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={onChangeQuery}
        placeholder="Search files"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel="Search files"
      />
      {query.length > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.searchClear, pressed && styles.backButtonPressed]}
          onPress={() => onChangeQuery('')}
          hitSlop={6}
          accessibilityLabel="Clear search"
        >
          <X size={16} color={colors.textSecondary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  )
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1
    ? { name: path, dir: '' }
    : { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

/** Flat results for a search: host-ranked paths, tap opens the preview. */
export function MobileFileExplorerSearchResults({
  paths,
  searching,
  onOpen
}: {
  paths: readonly string[]
  searching: boolean
  onOpen: (relativePath: string, displayName: string) => void
}) {
  if (paths.length === 0) {
    return (
      <View style={styles.state}>
        <Text style={styles.emptyText}>{searching ? 'Searching…' : 'No matches'}</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={paths}
      keyExtractor={(path) => path}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      style={styles.list}
      renderItem={({ item }) => {
        const { name, dir } = splitPath(item)
        return (
          <Pressable
            style={({ pressed }) => [styles.searchResultRow, pressed && styles.rowPressed]}
            onPress={() => {
              triggerSelection()
              onOpen(item, name)
            }}
            accessibilityLabel={`Preview file ${item}`}
          >
            <File size={17} color={colors.textSecondary} />
            <View style={styles.rowTextBlock}>
              <Text style={styles.searchResultName} numberOfLines={1}>
                {name}
              </Text>
              {dir ? (
                <Text style={styles.searchResultDir} numberOfLines={1}>
                  {dir}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )
      }}
    />
  )
}
