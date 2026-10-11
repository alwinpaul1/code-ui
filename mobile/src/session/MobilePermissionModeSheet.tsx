import { Code, Hand, ScrollText, Zap, type LucideIcon } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { permissionModeLabel, type TerminalPermissionMode } from './mobile-terminal-hud-parse'
import {
  PERMISSION_MODE_SHEET_SUBTITLE,
  permissionModeSheetRows,
  type PermissionModeSheetMode
} from './permission-mode-sheet-rows'

const ICONS: Record<PermissionModeSheetMode, LucideIcon> = {
  manual: Hand,
  acceptEdits: Code,
  plan: ScrollText,
  auto: Zap
}

/** The Claude app's "Select mode" sheet. Picking one steps Shift+Tab in the
 *  terminal until its footer shows that mode (terminal-mode-stepper.ts). */
export function MobilePermissionModeSheet({
  visible,
  current,
  runningModel = null,
  onSelect,
  onClose
}: {
  visible: boolean
  current: TerminalPermissionMode | null
  /** The model the agent says is running (badge or beacon), for Auto's row. */
  runningModel?: string | null
  onSelect: (mode: TerminalPermissionMode) => void
  onClose: () => void
}) {
  return (
    <ActionSheetModal
      visible={visible}
      title="Select mode"
      message={PERMISSION_MODE_SHEET_SUBTITLE}
      centerTitle
      actions={permissionModeSheetRows({ current, runningModel }).map((row) => ({
        label: permissionModeLabel(row.mode),
        hint: row.hint,
        icon: ICONS[row.mode],
        selected: row.selected,
        disabled: row.disabled,
        onPress: () => onSelect(row.mode)
      }))}
      onClose={onClose}
    />
  )
}
