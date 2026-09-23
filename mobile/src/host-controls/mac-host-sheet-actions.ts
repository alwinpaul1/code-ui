import { Lock, LockOpen, MonitorOff, Sunrise, Volume2, VolumeX, type LucideIcon } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { MAC_HOST_ACTION_LABELS, type MacHostAction } from './mac-host-commands'
import type { MacHostState } from './mac-host-state'
import { WINDOWS_HOST_ACTION_LABELS } from './windows-host-commands'

export type MacHostSheetOptions = {
  /** What the host said it runs. Anything but 'darwin' or 'win32' — including "not asked
   *  yet" — renders nothing. */
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

/** What differs between the two hosts the group appears on. */
type HostControlCopy = {
  group: string
  labels: Partial<Record<MacHostAction, string>>
  noWorktreeHint: string
  checkingLabel: string
  /** Whether Unlock exists. Windows takes a password only at its own sign-in screen,
   *  so a locked PC gets a row that says so instead (windows-host-commands.ts). */
  canUnlock: boolean
}

const HOST_CONTROL_COPY: Partial<Record<NodeJS.Platform, HostControlCopy>> = {
  darwin: {
    group: 'Mac',
    labels: MAC_HOST_ACTION_LABELS,
    noWorktreeHint: 'Open a workspace on this Mac first',
    checkingLabel: 'Checking the Mac…',
    canUnlock: true
  },
  win32: {
    group: 'Windows',
    labels: WINDOWS_HOST_ACTION_LABELS,
    noWorktreeHint: 'Open a workspace on this PC first',
    checkingLabel: 'Checking the PC…',
    canUnlock: false
  }
}

const WINDOWS_LOCKED_LABEL = 'Locked · unlock at the PC'

/** Only the rows that can do anything from where the Mac actually is: you cannot lock a
 *  locked Mac, wake a display that is already on, or mute a muted Mac. An unknown half offers both of its
 *  rows — a wrong row is better than a missing one when the Mac would not say. */
function actionsForState(state: MacHostState, canUnlock: boolean): MacHostAction[] {
  const lock: MacHostAction[] = !canUnlock
    ? state.lock === 'locked'
      ? []
      : ['lock']
    : state.lock === 'locked'
      ? ['unlock']
      : state.lock === 'unlocked'
        ? ['lock']
        : ['lock', 'unlock']
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

/** The Mac or Windows group, or an empty list on every other host — a Linux user must
 *  not see a disabled row, they must see no group at all. */
export function getMacHostSheetActions(
  options: MacHostSheetOptions | undefined
): ActionSheetAction[] {
  const copy = options?.hostPlatform ? HOST_CONTROL_COPY[options.hostPlatform] : undefined
  if (!options || !copy) {
    return []
  }
  if (options.state === 'checking') {
    return [
      {
        label: copy.checkingLabel,
        icon: MAC_ACTION_ICONS.lock,
        group: copy.group,
        disabled: true,
        loading: true,
        onPress: () => undefined
      }
    ]
  }
  const disabled = options.worktreeId === null
  // Said, not hidden: without it a locked PC's sheet has no lock row at all, and the
  // missing Unlock reads as a bug rather than as Windows.
  const lockedNote: ActionSheetAction[] =
    !copy.canUnlock && options.state.lock === 'locked'
      ? [
          {
            label: WINDOWS_LOCKED_LABEL,
            icon: MAC_ACTION_ICONS.lock,
            disabled: true,
            onPress: () => undefined
          }
        ]
      : []
  const rows: ActionSheetAction[] = actionsForState(options.state, copy.canUnlock).map((action) => ({
    label: copy.labels[action] ?? MAC_HOST_ACTION_LABELS[action],
    icon: MAC_ACTION_ICONS[action],
    ...(disabled ? { disabled: true, hint: copy.noWorktreeHint } : {}),
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
  return [...lockedNote, ...rows].map((row, index) => (index === 0 ? { ...row, group: copy.group } : row))
}
