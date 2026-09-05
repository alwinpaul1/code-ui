import { Code, Hand, ScrollText, Zap, ShieldOff, type LucideIcon } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { permissionModeLabel, type TerminalPermissionMode } from './mobile-terminal-hud-parse'

const OPTIONS: Array<{ mode: TerminalPermissionMode; hint: string; icon: LucideIcon }> = [
  { mode: 'manual', hint: 'Always ask before making changes', icon: Hand },
  { mode: 'acceptEdits', hint: 'Automatically accept all file edits', icon: Code },
  { mode: 'plan', hint: 'Create a plan before making changes', icon: ScrollText },
  { mode: 'auto', hint: 'Claude handles permission decisions', icon: Zap }
]

/** The Claude app's "Select mode" sheet. Picking one steps Shift+Tab in the
 *  terminal until its footer shows that mode. */
export function MobilePermissionModeSheet({
  visible,
  current,
  onSelect,
  onClose
}: {
  visible: boolean
  current: TerminalPermissionMode | null
  onSelect: (mode: TerminalPermissionMode) => void
  onClose: () => void
}) {
  const selected = current === 'default' ? 'manual' : current
  const options =
    selected === 'bypassPermissions'
      ? [...OPTIONS, { mode: 'bypassPermissions' as const, hint: 'Skip all permission prompts', icon: ShieldOff }]
      : OPTIONS
  return (
    <ActionSheetModal
      visible={visible}
      title="Select mode"
      centerTitle
      actions={options.map((option) => ({
        label: permissionModeLabel(option.mode),
        hint: option.hint,
        icon: option.icon,
        selected: option.mode === selected,
        onPress: () => onSelect(option.mode)
      }))}
      onClose={onClose}
    />
  )
}
