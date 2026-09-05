import { ActivityIndicator, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  selectHostWorkspaceListState,
  type HostWorkspaceListStateInput
} from './host-workspace-list-state'

export function HostWorkspaceListStates(
  props: HostWorkspaceListStateInput & {
    search: string
    activeFilterCount: number
  }
) {
  const { colors, space } = useTheme()
  const state = selectHostWorkspaceListState(props)
  const centered = { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const }
  if (state === 'loading') {
    return (
      <View style={centered}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (state === 'catalog-error') {
    return (
      <View style={[centered, { paddingHorizontal: space.xl }]}>
        <Txt variant="body" tone="secondary" align="center">
          Could not load workspaces from this host
        </Txt>
        <Txt variant="caption" tone="muted" align="center" style={{ marginTop: space.xs }}>
          {`worktree.ps failed (${props.catalogError}) — retrying automatically`}
        </Txt>
      </View>
    )
  }
  if (state === 'empty') {
    return (
      <View style={centered}>
        <Txt variant="body" tone="secondary">
          {props.search
            ? 'No matching workspaces'
            : props.activeFilterCount > 0
              ? 'No workspaces match the filters'
              : 'No workspaces yet'}
        </Txt>
      </View>
    )
  }
  return null
}
