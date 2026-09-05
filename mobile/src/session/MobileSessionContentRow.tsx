import { View } from 'react-native'
import { AlertTriangle, X } from 'lucide-react-native'
import { SessionDockColumn } from './SessionDockColumn'
import { dismissMobileSessionCreateWarningState } from './mobile-session-create-warning-state'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import { styles } from './mobile-session-styles'
import type { MobileSessionController } from './use-mobile-session-controller'
import { MobileSessionActiveContent } from './MobileSessionActiveContent'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'

export function MobileSessionContentRow({ controller }: { controller: MobileSessionController }) {
  const { colors, space } = useTheme()
  const {
    hostId,
    worktreeId,
    worktreeName,
    activePanel,
    setActivePanel,
    sessionContentRowWidth,
    canDockPanel,
    setCreateWarningState,
    createWarning,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleSessionContentRowLayout
  } = controller
  return (
    <View style={styles.sessionContentRow} onLayout={handleSessionContentRowLayout}>
      <View style={styles.sessionContentMain}>
        {createWarning ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: colors.warningSoft,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              paddingLeft: space.md,
              paddingRight: space.xs,
              paddingVertical: space.xs
            }}
          >
            <AlertTriangle size={16} color={colors.warning} strokeWidth={2.2} />
            <Txt variant="caption" style={{ flex: 1 }}>
              {createWarning}
            </Txt>
            <IconButton
              icon={X}
              size={32}
              iconSize={15}
              accessibilityLabel="Dismiss workspace creation warning"
              onPress={() => setCreateWarningState(dismissMobileSessionCreateWarningState)}
            />
          </View>
        ) : null}
        <MobileSessionActiveContent controller={controller} />
        {/* Why: translate instead of resize so keyboard toggles don't trigger a server-side PTY viewport change. */}
        <MobileSessionCommandDock controller={controller} />
      </View>
      {canDockPanel && activePanel !== null && (
        <SessionDockColumn
          activePanel={activePanel}
          hostId={hostId}
          worktreeId={worktreeId}
          name={worktreeName || ''}
          availableWidth={sessionContentRowWidth}
          onRequestClose={() => setActivePanel(null)}
          onFileOpenStart={handleFileOpenStart}
          onOpenedFileDiff={handleOpenedFileDiff}
        />
      )}
    </View>
  )
}
