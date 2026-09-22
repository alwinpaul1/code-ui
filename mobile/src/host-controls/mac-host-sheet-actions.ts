import { Lock, LockOpen, MonitorOff, Sunrise, Volume2, VolumeX, type LucideIcon } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { MAC_HOST_ACTION_LABELS, type MacHostAction } from './mac-host-commands'
import type { MacHostState } from './mac-host-state'

export type MacHostSheetOptions = {
  /** What the host said it runs. Anything but 'darwin' — including "not asked yet" — renders nothing. */
  hostPlatform: NodeJS.Platform | null
  /** The workspace whose terminal carries the command; null when the Mac has none. */
  worktreeId: string | null
  /** What the Mac itself reported, or 'checking' while the probe is still out. */
  state: MacHostState | 'checking'
  onAction: (action: MacHostAction) => void
  /** Hold on Unlock Mac. Forgets the password saved on this phone. */
  onForgetUnlockPassword?: () => void
}

const MAC_ACTION_ICONS: Record<MacHostAction, LucideIcon> = {
  lock: Lock,
  unlock: LockOpen,
  'sleep-display': MonitorOff,
  'wake-display': Sunrise,
  mute: VolumeX,
  unmute: Volume2
}

const NO_WORKTREE_HINT = 'Open a workspace on this Mac first'
const CHECKING_LABEL = 'Checking the Mac…'

/** Only the rows that can do anything from where the Mac actually is: you cannot lock a
 *  locked Mac, wake a display that is already on, or mute a muted Mac. An unknown half offers both of its
 *  rows — a wrong row is better than a missing one when the Mac would not say. */
function actionsForState(state: MacHostState): MacHostAction[] {
  const lock: MacHostAction[] =
    state.lock === 'locked' ? ['unlock'] : state.lock === 'unlocked' ? ['lock'] : ['lock', 'unlock']
  const display: MacHostAction[] =
    state.display === 'off'
      ? ['wake-display']
      : state.display === 'on'
        ? ['sleep-display']
        : ['sleep-display', 'wake-display']
  const mute: MacHostAction[] =
    state.mute === 'muted' ? ['unmute'] : state.mute === 'unmuted' ? ['mute'] : ['mute', 'unmute']
  return [...lock, ...display, ...mute]
}

/** The Mac group, or an empty list on every other host — a Windows or Linux user
 *  must not see a disabled Mac row, they must see no Mac row at all. */
export function getMacHostSheetActions(
  options: MacHostSheetOptions | undefined
): ActionSheetAction[] {
  if (options?.hostPlatform !== 'darwin') {
    return []
  }
  if (options.state === 'checking') {
    return [
      {
        label: CHECKING_LABEL,
        icon: MAC_ACTION_ICONS.lock,
        group: 'Mac',
        disabled: true,
        loading: true,
        onPress: () => undefined
      }
    ]
  }
  const disabled = options.worktreeId === null
  return actionsForState(options.state).map((action, index) => ({
    label: MAC_HOST_ACTION_LABELS[action],
    icon: MAC_ACTION_ICONS[action],
    ...(index === 0 ? { group: 'Mac' } : {}),
    ...(disabled ? { disabled: true, hint: NO_WORKTREE_HINT } : {}),
    ...(action === 'unlock' && options.onForgetUnlockPassword && !disabled
      ? {
          onLongPress: () => {
            options.onForgetUnlockPassword?.()
          }
        }
      : {}),
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
