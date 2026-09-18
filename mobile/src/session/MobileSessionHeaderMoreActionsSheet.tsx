import { ListChecks, Plug, ShieldCheck, FileText } from 'lucide-react-native'
import { MobileAgentSessionHistoryIcon } from '../agent-history/MobileAgentSessionHistoryIcon'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { colors } from '../theme/mobile-theme'

type Props = {
  visible: boolean
  showAgentSessionHistory: boolean
  showChecks: boolean
  showProjectConfigActions: boolean
  onOpenAgentSessionHistory: () => void
  onOpenChecks: () => void
  onOpenMcpServers: () => void
  onOpenPermissionRules: () => void
  onOpenProjectMemory: () => void
  onClose: () => void
}

export function MobileSessionHeaderMoreActionsSheet({
  visible,
  showAgentSessionHistory,
  showChecks,
  showProjectConfigActions,
  onOpenAgentSessionHistory,
  onOpenChecks,
  onOpenMcpServers,
  onOpenPermissionRules,
  onOpenProjectMemory,
  onClose
}: Props) {
  return (
    <ActionSheetModal
      visible={visible}
      actions={[
        ...(showAgentSessionHistory
          ? [
              {
                label: 'Agent History',
                hint: 'Browse and resume agent sessions',
                renderIcon: () => (
                  <MobileAgentSessionHistoryIcon
                    size={16}
                    color={colors.textSecondary}
                    strokeWidth={2.1}
                  />
                ),
                onPress: onOpenAgentSessionHistory
              }
            ]
          : []),
        ...(showChecks
          ? [
              {
                label: 'Checks',
                hint: 'Open pull request checks',
                icon: ListChecks,
                onPress: onOpenChecks
              }
            ]
          : []),
        ...(showProjectConfigActions
          ? [
              {
                label: 'MCP Servers',
                hint: '.mcp.json — project scope only',
                icon: Plug,
                onPress: onOpenMcpServers
              },
              {
                label: 'Permission Rules',
                hint: '.claude/settings.json — project scope only',
                icon: ShieldCheck,
                onPress: onOpenPermissionRules
              },
              {
                label: 'Project Memory',
                hint: 'CLAUDE.md — project scope only',
                icon: FileText,
                onPress: onOpenProjectMemory
              }
            ]
          : [])
      ]}
      onClose={onClose}
    />
  )
}
