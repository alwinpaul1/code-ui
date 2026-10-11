import {
  Activity,
  Copy,
  FileText,
  GitBranch,
  ListChecks,
  Pencil,
  Plug,
  ShieldCheck
} from 'lucide-react-native'
import { MobileAgentSessionHistoryIcon } from '../agent-history/MobileAgentSessionHistoryIcon'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { useTheme } from '../theme/theme-context'
import type { SessionHeaderMenuEntry } from './session-header-menu'

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
  /** The Claude app's session entries this session can offer, in its order
   *  (sessionHeaderMenuEntries). Copy session ID is drawn last, where the app
   *  keeps it in its own group. */
  sessionEntries: readonly SessionHeaderMenuEntry[]
  onCopyBranch: () => void
  onOpenBackgroundTasks: () => void
  onRename: () => void
  onCopySessionId: () => void
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
  sessionEntries,
  onCopyBranch,
  onOpenBackgroundTasks,
  onRename,
  onCopySessionId,
  onClose
}: Props) {
  const { colors } = useTheme()
  const has = (entry: SessionHeaderMenuEntry) => sessionEntries.includes(entry)
  const sessionActions: ActionSheetAction[] = [
    ...(has('copy-branch')
      ? [{ label: 'Copy branch', icon: GitBranch, onPress: onCopyBranch }]
      : []),
    // Both open a sheet or a dialog, so they wait for this one to leave
    // (the dual-Modal race, #10331).
    ...(has('background-tasks')
      ? [
          {
            label: 'Background tasks',
            icon: Activity,
            closeBeforePress: true,
            onPress: onOpenBackgroundTasks
          }
        ]
      : []),
    ...(has('rename')
      ? [{ label: 'Rename', icon: Pencil, closeBeforePress: true, onPress: onRename }]
      : [])
  ]
  return (
    <ActionSheetModal
      visible={visible}
      actions={[
        ...sessionActions,
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
          : []),
        ...(has('copy-session-id')
          ? [{ label: 'Copy session ID', icon: Copy, onPress: onCopySessionId }]
          : [])
      ]}
      onClose={onClose}
    />
  )
}
