import type { MobilePullToRefresh } from '../../source-control/mobile-pull-to-refresh'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { RotateCw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, useThemedStyles } from '../../theme/theme-context'
import type { Theme } from '../../theme/theme-context'
import type { ConnectionState } from '../../transport/types'
import type { RpcClient } from '../../transport/rpc-client'
import type { MobileGitStatusResult } from '../../source-control/mobile-git-status'
import type { MobilePrSidebarController } from '../../session/use-mobile-pr-sidebar-controller'
import { MobilePRSidebar } from '../MobilePRSidebar'
import { mobilePrSidebarStyles } from './mobile-pr-sidebar-styles'

type Props = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  branch: string | null
  headSha: string | null
  gitStatus: MobileGitStatusResult | null
  isGithubRepo?: boolean
  branchContextLoaded?: boolean
  controller: MobilePrSidebarController
  pullToRefresh?: MobilePullToRefresh
}

// Chromeless PR sidebar body for the source-control hub's Pull Request segment.
// The hub owns the header, segmented control, load triggers, and the shared
// controller (one fetch feeds both the branch-card chip and this body).
export function MobilePrViewPanelBody({
  client,
  connState,
  worktreeId,
  branch,
  headSha,
  gitStatus,
  isGithubRepo = true,
  branchContextLoaded = true,
  controller,
  pullToRefresh
}: Props) {
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(mobilePrViewPanelStyles)

  // The GitHub probe failed rather than answered: saying "unavailable for this provider" here
  // would tell a GitHub repo it has no review panel, over one relay timeout.
  if (branchContextLoaded && controller.prSidebarRepoProbeFailed) {
    return (
      <View style={styles.container}>
        <RepoProbeFailed onRetry={controller.retryPrSidebarRepoProbe} />
      </View>
    )
  }

  const sidebarState = !branchContextLoaded
    ? ({ kind: 'loading' } as const)
    : !isGithubRepo
      ? ({
          kind: 'blocked',
          message: 'Hosted review panel unavailable for this provider.'
        } as const)
      : branch === null
        ? ({
            kind: 'error',
            message: 'Current branch unavailable.'
          } as const)
        : controller.prSidebarState

  return (
    <View style={styles.container}>
      <MobilePRSidebar
        state={sidebarState}
        onRetry={controller.retryPRSidebar}
        refetch={controller.refetchPRSidebar}
        client={client}
        connState={connState}
        worktreeId={worktreeId}
        gitBranch={branch}
        gitStatus={gitStatus}
        headSha={headSha}
        bottomInset={insets.bottom}
        // Hub header already hosts open-on-web while this segment is active.
        showOpenOnWeb={false}
        pullToRefresh={pullToRefresh}
      />
    </View>
  )
}

function RepoProbeFailed({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(mobilePrSidebarStyles)
  return (
    <View style={styles.stateArea}>
      <Text style={styles.stateText}>Could not check the repository.</Text>
      <Pressable
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry checking the repository"
      >
        <RotateCw size={14} color={colors.text} strokeWidth={2.2} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  )
}

function mobilePrViewPanelStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg
    }
  })
}
