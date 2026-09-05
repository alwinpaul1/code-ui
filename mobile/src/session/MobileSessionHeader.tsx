import { View, ScrollView, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  Folder,
  MessageSquare,
  Terminal,
  File,
  FileText,
  GitBranch,
  Globe,
  MoreHorizontal,
  Plus
} from 'lucide-react-native'
import { MobileSessionHeaderIconButton } from './MobileSessionHeaderIconButton'
import { triggerMediumImpact } from '../platform/haptics'
import { StatusDot } from '../components/StatusDot'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import {
  getMobileSessionTabTitle,
  resolveMobileTerminalTabAgentId
} from './mobile-terminal-tab-agent'
import { mobileModelPillLabel } from './mobile-native-chat-session-option-labels'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import { QuickCommandsTabButton } from './QuickCommandsTabButton'
import type { MobileSessionController } from './use-mobile-session-controller'

/** The active session's model label, or null when the agent has no model
 *  catalog or the tracked value is still the placeholder (#18568). */
export function resolveSessionModelLabel(controller: MobileSessionController): string | null {
  const snapshot = controller.nativeChatController.nativeChatSessionOptions?.controller.snapshot
  const model = snapshot?.find((descriptor) => descriptor.category === 'model')
  if (!model) {
    return null
  }
  const label = mobileModelPillLabel(model)
  return label === 'Model' ? null : label
}

export function MobileSessionHeader({ controller }: { controller: MobileSessionController }) {
  const { colors, space, radius } = useTheme()
  const {
    hostId,
    isFolderWorkspaceRoute,
    isFloatingWorkspaceRoute,
    connState,
    forceReconnectHost,
    worktreeName,
    activePanel,
    activeSessionTabId,
    activeSessionTabIdRef,
    tabStripRef,
    tabStripOffsetRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabLayoutsRef,
    creating,
    creatingBrowser,
    creatingMarkdown,
    setCreateError,
    setShowCreateTabDrawer,
    setShowQuickCommands,
    setShowHeaderMoreActions,
    quickCommandsSupported,
    showToast,
    requestLeaveSession,
    scrollActiveTabIntoView,
    switchSessionTab,
    openSessionTabActionSheetAfterKeyboardDismiss,
    visibleTabs,
    showConnectionRetry,
    terminalSummary,
    handlePanelTap,
    showHeaderMoreButton
  } = controller
  const modelLabel = resolveSessionModelLabel(controller)
  // Why: chat and terminal are two views of the same agent session; the user
  // switches between them from the header instead of the tab long-press sheet.
  const { activeChatEligible, showNativeChat } = controller.nativeChatController
  const { switchTabView } = controller
  const viewToggle =
    activeChatEligible && activeSessionTabId
      ? {
          label: showNativeChat ? 'Show terminal' : 'Show chat',
          icon: showNativeChat ? Terminal : MessageSquare,
          onPress: () => void switchTabView(activeSessionTabId)
        }
      : null
  const createDisabled =
    creating || creatingBrowser || creatingMarkdown || connState !== 'connected'

  return (
    <SafeAreaView
      style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border }}
      edges={['top']}
    >
      <View
        style={{
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.sm,
          gap: 2
        }}
      >
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Back to workspaces"
          onPress={requestLeaveSession}
        />

        <View style={{ flex: 1, minWidth: 0, marginRight: space.xs }}>
          <Txt variant="heading" weight="semibold" numberOfLines={1}>
            {worktreeName || 'Terminal'}
          </Txt>
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}
            disabled={!showConnectionRetry}
            onPress={() => {
              if (hostId) {
                void forceReconnectHost(hostId)
              }
            }}
            accessibilityRole={showConnectionRetry ? 'button' : undefined}
            accessibilityLabel={showConnectionRetry ? 'Reconnect to desktop' : undefined}
          >
            <StatusDot state={connState} gap={false} size={7} />
            <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {terminalSummary}
            </Txt>
            {modelLabel ? (
              <View
                accessibilityLabel={`Model ${modelLabel}`}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radius.xs,
                  backgroundColor: colors.accentSoft
                }}
              >
                <Txt variant="caption" weight="medium" tone="accent" numberOfLines={1}>
                  {modelLabel}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </View>
        {viewToggle ? (
          <MobileSessionHeaderIconButton
            accessibilityLabel={viewToggle.label}
            icon={viewToggle.icon}
            onPress={viewToggle.onPress}
          />
        ) : null}
        {!isFloatingWorkspaceRoute && (
          <MobileSessionHeaderIconButton
            active={activePanel === 'files'}
            accessibilityLabel="Open file explorer"
            icon={Folder}
            onPress={() => handlePanelTap('files')}
          />
        )}
        {!isFolderWorkspaceRoute && !isFloatingWorkspaceRoute && (
          <MobileSessionHeaderIconButton
            active={activePanel === 'sourceControl'}
            accessibilityLabel="Open source control"
            icon={GitBranch}
            onPress={() => handlePanelTap('sourceControl')}
          />
        )}
        {showHeaderMoreButton ? (
          <MobileSessionHeaderIconButton
            active={activePanel === 'pr'}
            accessibilityLabel="More session actions"
            icon={MoreHorizontal}
            onPress={() => setShowHeaderMoreActions(true)}
          />
        ) : null}
      </View>

      {visibleTabs.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingBottom: space.sm,
            paddingRight: space.xs
          }}
        >
          {/* Why: tab taps must register on first press with the keyboard open instead of being eaten by dismissal (#5106). */}
          <ScrollView
            ref={tabStripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, minWidth: 0 }}
            contentContainerStyle={{
              paddingLeft: space.lg,
              paddingRight: space.sm,
              gap: space.sm,
              alignItems: 'center'
            }}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScroll={(e) => {
              tabStripOffsetRef.current = e.nativeEvent.contentOffset.x
            }}
            onLayout={(e) => {
              tabStripViewportWidthRef.current = e.nativeEvent.layout.width
              scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
            }}
            onContentSizeChange={(width) => {
              tabStripContentWidthRef.current = width
              scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
            }}
          >
            {visibleTabs.map((t) => {
              const active = t.id === activeSessionTabId
              const iconColor = active ? colors.textInverse : colors.textSecondary
              const terminalAgentId =
                t.type === 'terminal' ? resolveMobileTerminalTabAgentId(t) : null
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    height: 32,
                    maxWidth: 168,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    backgroundColor: active
                      ? colors.text
                      : pressed
                        ? colors.bgRaised
                        : colors.bgPanel,
                    borderWidth: active ? 0 : 1,
                    borderColor: colors.border
                  })}
                  onLayout={(e) => {
                    const { x, width } = e.nativeEvent.layout
                    tabLayoutsRef.current.set(t.id, { x, width })
                    if (t.id === activeSessionTabIdRef.current) {
                      scrollActiveTabIntoView(t.id, false)
                    }
                  }}
                  onPress={() => switchSessionTab(t)}
                  onLongPress={() => {
                    triggerMediumImpact()
                    openSessionTabActionSheetAfterKeyboardDismiss(t)
                  }}
                  delayLongPress={400}
                >
                  {t.type === 'browser' && <Globe size={13} color={iconColor} strokeWidth={2.1} />}
                  {t.type === 'markdown' && (
                    <FileText size={13} color={iconColor} strokeWidth={2.1} />
                  )}
                  {t.type === 'file' && <File size={13} color={iconColor} strokeWidth={2.1} />}
                  {t.type === 'agent-session' && (
                    <MobileAgentIcon agentId={t.agent} size={13} color={iconColor} />
                  )}
                  {terminalAgentId ? (
                    <MobileAgentIcon agentId={terminalAgentId} size={13} color={iconColor} />
                  ) : null}
                  <Txt
                    variant="label"
                    weight={active ? 'semibold' : 'medium'}
                    numberOfLines={1}
                    style={{ flexShrink: 1, color: active ? colors.textInverse : colors.text }}
                  >
                    {getMobileSessionTabTitle(t)}
                  </Txt>
                </Pressable>
              )
            })}
          </ScrollView>
          {/* Why: pinned outside the scroll strip so the new-agent button stays reachable however far the tabs scroll. */}
          <IconButton
            icon={Plus}
            accessibilityLabel="New tab"
            size={36}
            iconSize={17}
            disabled={createDisabled}
            onPress={() => {
              setCreateError('')
              setShowCreateTabDrawer(true)
            }}
          />
          {/* Why: stable placement matters, while old hosts must stay gated because they strip agentPrompt. */}
          <QuickCommandsTabButton
            disabled={createDisabled}
            onPress={() => {
              if (quickCommandsSupported === true) {
                setShowQuickCommands(true)
                return
              }
              showToast(
                quickCommandsSupported === false
                  ? 'Desktop update required for quick commands'
                  : 'Checking desktop capabilities — try again in a moment',
                1600
              )
            }}
          />
        </View>
      )}
    </SafeAreaView>
  )
}
