import { Activity, Edit3, PowerOff, RefreshCw } from 'lucide-react-native'
import type { ActionSheetAction } from './components/ActionSheetModal'
import {
  getMacHostSheetActions,
  type MacHostSheetOptions
} from './host-controls/mac-host-sheet-actions'
import type { ConnectionState, HostProfile } from './transport/types'

/** Builds the home-screen host long-press menu. Navigation and second drawers
 *  defer until this sheet's native Modal has unmounted —
 *  presenting into a live one freezes the whole screen on iOS (issue #8791). */
export function getHostListActionSheetActions(args: {
  host: HostProfile | null
  state: ConnectionState
  /** Label "Connect" (not "Reconnect") when never connected this session, so the verb matches the action. */
  hasEverConnected: boolean
  onDismiss: () => void
  onReconnect: (hostId: string) => void
  onDisconnect: (hostId: string) => void
  onDiagnostics: (hostId: string) => void
  onEdit: (hostId: string) => void
  onRemove: (host: HostProfile) => void
  /** Absent on every host that is not a Mac, which is how a Windows user never sees the group. */
  mac?: MacHostSheetOptions
}): ActionSheetAction[] {
  const { host } = args
  if (!host) {
    return []
  }
  const macActions = getMacHostSheetActions(args.mac)
  const isLive =
    args.state === 'connected' ||
    args.state === 'connecting' ||
    args.state === 'handshaking' ||
    args.state === 'reconnecting'

  return [
    {
      label: args.hasEverConnected && isLive ? 'Reconnect' : 'Connect',
      icon: RefreshCw,
      onPress: () => {
        args.onDismiss()
        args.onReconnect(host.id)
      }
    },
    ...(isLive
      ? [
          {
            label: 'Disconnect',
            icon: PowerOff,
            onPress: () => {
              args.onDismiss()
              args.onDisconnect(host.id)
            }
          }
        ]
      : []),
    ...macActions,
    {
      label: 'Network diagnostics',
      icon: Activity,
      // Why only alongside the Mac group: without it there is nothing to separate,
      // and a lone header over an unchanged sheet would be noise.
      ...(macActions.length > 0 ? { group: 'Host' } : {}),
      closeBeforePress: true,
      onPress: () => {
        args.onDiagnostics(host.id)
      }
    },
    {
      label: 'Edit host',
      icon: Edit3,
      closeBeforePress: true,
      onPress: () => {
        args.onDismiss()
        args.onEdit(host.id)
      }
    },
    {
      label: 'Remove',
      destructive: true,
      closeBeforePress: true,
      onPress: () => {
        args.onRemove(host)
      }
    }
  ]
}
