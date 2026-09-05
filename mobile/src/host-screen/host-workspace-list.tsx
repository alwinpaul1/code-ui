import { Pressable, RefreshControl, SectionList, View } from 'react-native'
import { ChevronDown, ChevronRight, Pin } from 'lucide-react-native'
import { AuthFailedBanner } from '../components/AuthFailedBanner'
import { HostDiagnosticsLink } from '../components/HostDiagnosticsLink'
import { HostRouteNoticeBanner } from '../components/HostRouteNoticeBanner'
import { MobileRepoIcon } from '../components/MobileRepoIcon'
import { MobileSearchField } from '../components/MobileSearchField'
import { NewWorkspaceFab, FAB_SIZE } from '../components/NewWorkspaceFab'
import { WorktreeListRow } from '../components/WorktreeListRow'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { getWorktreeRowIdentity } from '../worktree/worktree-host-row-identity'
import { HostWorkspaceListStates } from '../worktree/host-workspace-list-states'
import { getWorktreeStatus } from '../worktree/workspace-list-sections'
import { repoColor } from '../worktree/repo-color'
import type { HostScreenController } from './use-host-screen-controller'

export function HostWorkspaceList({ controller }: { controller: HostScreenController }) {
  const { colors, space } = useTheme()
  const {
    actions,
    activeWorktreeScroll,
    catalog,
    connState,
    contentMaxWidth,
    displayWorktrees,
    embedded,
    forceReconnectHost,
    hostId,
    insets,
    isReadOnly,
    isWideLayout,
    noticeParam,
    now,
    reconnectAttempts,
    relayRecovery,
    routeNotice,
    router,
    sectionsResult,
    setDismissedNotice,
    settings,
    state
  } = controller
  const { rawSections, sections, uniqueRepoColors } = sectionsResult

  return (
    <>
      {/* Auth failed: a latched relay rejection must reach the same re-pair affordance. */}
      {(connState === 'auth-failed' || relayRecovery.pairingRejected) && (
        <AuthFailedBanner
          canRetry={!!hostId}
          onRetry={() => hostId && void forceReconnectHost(hostId)}
          onRepair={() => router.push('/pair-scan')}
          onRemove={() => state.setConfirmRemoveHost(true)}
        />
      )}

      {connState !== 'connected' &&
      !relayRecovery.pairingRejected &&
      reconnectAttempts >= 3 &&
      hostId ? (
        <HostDiagnosticsLink
          onPress={() =>
            router.push({ pathname: '/connection-log', params: { hostId: String(hostId) } })
          }
        />
      ) : null}

      {/* Why a bounced route landed here (e.g. the workspace was deleted on the desktop). */}
      {routeNotice && (
        <HostRouteNoticeBanner
          message={routeNotice}
          onDismiss={() => setDismissedNotice(noticeParam ?? null)}
        />
      )}

      {/* Search bar */}
      {state.showSearch && (
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}>
          <MobileSearchField
            value={state.search}
            onChangeText={state.setSearch}
            placeholder="Search workspaces…"
            autoFocus
            // Why: new key per open remounts the focus effect across rapid toggles so the keyboard reappears.
            focusKey={state.showSearch}
            accessibilityLabel="Search workspaces"
          />
        </View>
      )}

      <HostWorkspaceListStates
        connState={connState}
        worktreesLoaded={state.worktreesLoaded}
        displayCount={displayWorktrees.length}
        sectionCount={sections.length}
        catalogError={state.catalogError}
        search={state.search}
        activeFilterCount={settings.activeFilterCount}
      />

      {sections.length > 0 && (
        <SectionList
          ref={activeWorktreeScroll.sectionListRef}
          sections={sections}
          keyExtractor={(w) => w.sectionListKey ?? getWorktreeRowIdentity(w)}
          stickySectionHeadersEnabled={false}
          // Why: keep the search IME up while tapping clear / scrolling results.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollToIndexFailed={activeWorktreeScroll.onScrollToIndexFailed}
          // Why: edge-to-edge under the system nav bar; insets.bottom keeps the last row above it.
          contentContainerStyle={[
            { paddingBottom: (embedded ? space.lg : FAB_SIZE + space.xl) + insets.bottom },
            isWideLayout &&
              !embedded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
          ]}
          renderSectionHeader={({ section }) => {
            if (!section.title) {
              return null
            }
            const isCollapsed = state.collapsedGroups.has(section.key)
            const rawSection = rawSections.find((s) => s.key === section.key)
            const count = rawSection?.data.length ?? 0
            const repoSectionColor =
              state.groupMode === 'repo' ? uniqueRepoColors.get(section.title) : null
            const repoSectionIcon =
              state.groupMode === 'repo' ? state.repoIconsByName.get(section.title) : null
            return (
              <Pressable
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.xs + 2,
                  paddingHorizontal: space.lg,
                  paddingTop: space.lg,
                  paddingBottom: space.xs
                }}
                onPress={() => settings.toggleCollapsed(section.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
              >
                {isCollapsed ? (
                  <ChevronRight size={12} color={colors.textMuted} />
                ) : (
                  <ChevronDown size={12} color={colors.textMuted} />
                )}
                {section.icon === 'pin' && <Pin size={12} color={colors.textMuted} />}
                {state.groupMode === 'repo' ? (
                  <MobileRepoIcon
                    repoIcon={repoSectionIcon}
                    size={14}
                    color={repoSectionColor ?? colors.textSecondary}
                  />
                ) : null}
                <Txt
                  variant="caption"
                  weight="semibold"
                  tone="muted"
                  style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
                >
                  {section.title}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {count}
                </Txt>
              </Pressable>
            )
          }}
          ItemSeparatorComponent={ListSeparator}
          // Why (#8498): manual pull-to-refresh forces a fresh snapshot after a stale-cache reconnect.
          refreshControl={
            <RefreshControl
              refreshing={catalog.refreshing}
              onRefresh={catalog.onRefresh}
              tintColor={colors.textSecondary}
              colors={[colors.accent]}
              progressBackgroundColor={colors.bgPanel}
            />
          }
          renderItem={({ item }) => (
            <WorktreeListRow
              item={item}
              isReadOnly={isReadOnly}
              now={now}
              status={getWorktreeStatus(item)}
              repoColor={uniqueRepoColors.get(item.repo) ?? repoColor(item.repo)}
              repoIcon={state.repoIconsByName.get(item.repo) ?? null}
              hideRepo={state.groupMode === 'repo'}
              onPress={actions.openWorktreeSession}
              onLongPress={
                item.workspaceKind === 'folder-workspace' ? undefined : state.setActionTarget
              }
              onToggleLineage={settings.toggleWorktreeLineage}
            />
          )}
        />
      )}

      {/* Floating "new workspace" button — phone only; embedded sidebars keep the toolbar +. */}
      {!embedded && (
        <NewWorkspaceFab
          onPress={actions.openNewWorktreeModal}
          disabled={connState !== 'connected'}
        />
      )}
    </>
  )
}

function ListSeparator() {
  const { colors, space } = useTheme()
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginLeft: space.lg + 3 + 28,
        marginRight: space.lg
      }}
    />
  )
}
