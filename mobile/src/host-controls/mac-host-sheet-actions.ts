import { Lock, LockOpen, MonitorOff, Sunrise, type LucideIcon } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { MAC_HOST_ACTION_LABELS, type MacHostAction } from './mac-host-commands'

export type MacHostSheetOptions = {
  /** What the host said it runs. Anything but 'darwin' — including "not asked yet" — renders nothing. */
  hostPlatform: NodeJS.Platform | null
  /** The workspace whose terminal carries the command; null when the Mac has none. */
  worktreeId: string | null
  onAction: (action: MacHostAction) => void
}

const MAC_ACTION_ORDER: MacHostAction[] = ['lock', 'unlock', 'sleep-display', 'wake-display']

const MAC_ACTION_ICONS: Record<MacHostAction, LucideIcon> = {
  lock: Lock,
  unlock: LockOpen,
  'sleep-display': MonitorOff,
  'wake-display': Sunrise
}

const NO_WORKTREE_HINT = 'Open a workspace on this Mac first'

/** The Mac group, or an empty list on every other host — a Windows or Linux user
 *  must not see a disabled Mac row, they must see no Mac row at all. */
export function getMacHostSheetActions(options: MacHostSheetOptions | undefined): ActionSheetAction[] {
  if (options?.hostPlatform !== 'darwin') {
    return []
  }
  const disabled = options.worktreeId === null
  return MAC_ACTION_ORDER.map((action, index) => ({
    label: MAC_HOST_ACTION_LABELS[action],
    icon: MAC_ACTION_ICONS[action],
    ...(index === 0 ? { group: 'Mac' } : {}),
    ...(disabled ? { disabled: true, hint: NO_WORKTREE_HINT } : {}),
    // Why deferred: Unlock may open the password drawer, and presenting a second
    // native modal while this sheet's is still up freezes the screen (issue #8791).
    closeBeforePress: true,
    onPress: () => {
      if (!disabled) {
        options.onAction(action)
      }
    }
  }))
}
