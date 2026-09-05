import { ScrollView, View } from 'react-native'
import {
  ChevronLeft,
  Filter,
  Layers,
  List,
  PanelLeftClose,
  Plus,
  Search,
  SlidersHorizontal,
  SquareTerminal,
  UserCircle,
  X
} from 'lucide-react-native'
import { StatusDot } from '../components/StatusDot'
import { classifyConnection, type ConnectionVerdict } from '../transport/connection-health'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import type { HostScreenController } from './use-host-screen-controller'

function isErrorVerdict(v: ConnectionVerdict): boolean {
  return v.kind === 'warning' || v.kind === 'unreachable' || v.kind === 'auth-failed'
}

function groupLabel(groupMode: HostScreenController['state']['groupMode']): string {
  switch (groupMode) {
    case 'none':
      return 'Group'
    case 'workspaceStatus':
      return 'Status'
    case 'repo':
      return 'Repo'
    case 'prStatus':
      return 'PR'
    default: {
      const exhaustive: never = groupMode
      return exhaustive
    }
  }
}

export function HostScreenHeader({ controller }: { controller: HostScreenController }) {
  const { colors, space } = useTheme()
  const {
    actions,
    connState,
    embedded,
    floatingWorkspaceEnabled,
    forceReconnectHost,
    hostId,
    lastConnectedAt,
    onHideSidebar,
    reconnectAttempts,
    relayRecovery,
    settings,
    state
  } = controller

  const headerVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    ...relayRecovery
  })
  // Why: auth-failed has its own banner, so suppress the Reconnect button for that verdict.
  const showReconnectButton =
    connState !== 'connected' &&
    isErrorVerdict(headerVerdict) &&
    !!hostId &&
    headerVerdict.kind !== 'auth-failed'
  const online = connState === 'connected'
  const filterCount = settings.activeFilterCount

  return (
    <View
      style={{
        backgroundColor: colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          paddingLeft: space.sm,
          paddingRight: space.sm,
          gap: space.xs
        }}
      >
        <IconButton icon={ChevronLeft} accessibilityLabel="Back to hosts" onPress={actions.leaveHost} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <StatusDot state={connState} verdict={headerVerdict} gap={false} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="heading" weight="semibold" numberOfLines={1}>
              {state.hostName || 'Host'}
            </Txt>
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {headerVerdict.label}
            </Txt>
          </View>
        </View>
        {showReconnectButton ? (
          <Button
            label="Reconnect"
            size="sm"
            variant="secondary"
            onPress={() => void forceReconnectHost(hostId!)}
          />
        ) : null}
        {!embedded && floatingWorkspaceEnabled ? (
          <IconButton
            icon={SquareTerminal}
            accessibilityLabel="Floating Workspace"
            onPress={actions.openFloatingWorkspace}
            disabled={!online}
          />
        ) : null}
        {embedded && onHideSidebar ? (
          <IconButton
            icon={PanelLeftClose}
            accessibilityLabel="Hide sidebar"
            onPress={onHideSidebar}
            size={32}
            iconSize={14}
          />
        ) : null}
      </View>

      {/* Filter / sort / group chips, then the screen actions. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: space.lg,
          paddingRight: space.sm,
          paddingBottom: space.sm,
          gap: space.xs
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, minWidth: 0 }}
          contentContainerStyle={{ gap: space.sm, alignItems: 'center', paddingRight: space.sm }}
          keyboardShouldPersistTaps="handled"
        >
          <Chip
            size="sm"
            icon={Filter}
            label={filterCount > 0 ? `Filter · ${filterCount}` : 'Filter'}
            selected={filterCount > 0}
            accessibilityLabel={`Filter workspaces${filterCount > 0 ? `, ${filterCount} active` : ''}`}
            onPress={() => state.setShowFilterModal(true)}
          />
          <Chip
            size="sm"
            icon={SlidersHorizontal}
            label={settings.selectedSortLabel}
            accessibilityLabel={`Sort by ${settings.selectedSortLabel}`}
            onPress={() => state.setShowSortPicker(true)}
          />
          <Chip
            size="sm"
            icon={Layers}
            label={groupLabel(state.groupMode)}
            selected={state.groupMode !== 'none'}
            accessibilityLabel="Group workspaces"
            onPress={() => state.setShowGroupPicker(true)}
          />
        </ScrollView>
        <IconButton
          icon={UserCircle}
          accessibilityLabel="Accounts"
          size={36}
          onPress={() => actions.navigateFromHostList(`/h/${hostId}/accounts`)}
          disabled={!online}
        />
        <IconButton
          icon={List}
          accessibilityLabel="Tasks"
          size={36}
          onPress={() => actions.navigateFromHostList(`/h/${hostId}/tasks`)}
          disabled={!online}
        />
        {embedded ? (
          <IconButton
            icon={Plus}
            accessibilityLabel="New workspace"
            size={36}
            onPress={actions.openNewWorktreeModal}
            disabled={!online}
          />
        ) : null}
        <IconButton
          icon={state.showSearch ? X : Search}
          accessibilityLabel={state.showSearch ? 'Close search' : 'Search workspaces'}
          size={36}
          active={state.showSearch}
          onPress={() => state.setShowSearch((s) => !s)}
        />
      </View>
    </View>
  )
}
