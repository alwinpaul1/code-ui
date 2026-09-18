import { Eraser, GitBranch, Monitor, Smartphone } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { canForkClaudeSession } from './claude-fork-session'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { getMobileNativeChatToggleActions } from './mobile-native-chat-toggle-action'

type TerminalTab = MobileNativeChatTab & { id: string; terminal: string | null }

/** Same agent-identity precedence as the tab icon (mobile-terminal-tab-agent.ts):
 *  the live hook wins, falling back to what Orca launched. Neither field being
 *  present yet reads as "unknown", not "claude" — refuse rather than guess. */
function terminalTabAgentId(tab: TerminalTab | undefined): string | null {
  const hookAgentType = tab?.agentStatus?.agentType?.trim()
  return (hookAgentType && hookAgentType !== 'unknown' ? hookAgentType : null) ?? tab?.launchAgent ?? null
}

/** Builds the terminal long-press menu without adding another action block to the
 *  already dense session route. Native chat stays first as the view switch. */
export function getMobileTerminalActionSheetActions<
  Target extends { handle: string },
  Tab extends TerminalTab
>(args: {
  target: Target | null
  tabs: readonly Tab[]
  isTabChatView: (tabId: string) => boolean
  nativeChatTranscriptIsLocalReadable: boolean
  onDismiss: () => void
  onToggleChat: (tabId: string) => void
  isPhoneMode: (handle: string) => boolean
  onToggleDisplayMode: (handle: string) => void
  onRename: (target: Target) => void
  onClear: (target: Target) => void
  /** Types `/fork` and submits it. Only offered for an idle Claude Code pane —
   *  see claude-fork-session.ts for why. */
  onFork: (target: Target) => void
  /** Fallback for a live handle with no matching session tab. */
  onClose: (target: Target) => void
  /** Preferred path runs host teardown and records the local tombstone. */
  onCloseSessionTab: (tab: Tab) => void
  /** Appended after Close; receives the pressed tab's id so the session route's
   *  bulk-close builder can resolve the anchor itself. */
  bulkCloseActions?: (anchorTabId: string | undefined, dismiss: () => void) => ActionSheetAction[]
}): ActionSheetAction[] {
  const { target } = args
  if (!target) {
    return []
  }
  const phoneMode = args.isPhoneMode(target.handle)
  const sessionTab = args.tabs.find((tab) => tab.terminal === target.handle)
  return [
    ...getMobileNativeChatToggleActions({
      terminalHandle: target.handle,
      tabs: args.tabs,
      isTabChatView: args.isTabChatView,
      nativeChatTranscriptIsLocalReadable: args.nativeChatTranscriptIsLocalReadable,
      onClose: args.onDismiss,
      onToggle: args.onToggleChat
    }),
    {
      label: phoneMode ? 'Switch to Desktop' : 'Switch to Phone',
      icon: phoneMode ? Monitor : Smartphone,
      onPress: () => {
        args.onDismiss()
        args.onToggleDisplayMode(target.handle)
      }
    },
    {
      label: 'Rename',
      closeBeforePress: true,
      onPress: () => {
        args.onRename(target)
      }
    },
    ...(canForkClaudeSession({
      agent: terminalTabAgentId(sessionTab),
      status: sessionTab?.agentStatus?.state ?? null
    })
      ? [
          {
            label: 'Fork',
            icon: GitBranch,
            hint: 'Forks from the latest message',
            onPress: () => {
              args.onDismiss()
              args.onFork(target)
            }
          }
        ]
      : []),
    {
      label: 'Clear Terminal',
      icon: Eraser,
      onPress: () => {
        args.onDismiss()
        args.onClear(target)
      }
    },
    {
      label: 'Close',
      destructive: true,
      onPress: () => {
        args.onDismiss()
        if (sessionTab) {
          args.onCloseSessionTab(sessionTab)
          return
        }
        args.onClose(target)
      }
    },
    ...(args.bulkCloseActions?.(sessionTab?.id, args.onDismiss) ?? [])
  ]
}
