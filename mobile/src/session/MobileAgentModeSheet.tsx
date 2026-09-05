import { ScrollText, Zap } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { CODEX_AGENT_MODES, type TerminalAgentMode } from './mobile-terminal-hud-parse'

/** Codex's collaboration modes, mirroring the Claude "Select mode" sheet.
 *  Picking one steps Shift+Tab in the terminal until its footer agrees. */
export function MobileAgentModeSheet({
  visible,
  current,
  onSelect,
  onClose
}: {
  visible: boolean
  current: TerminalAgentMode | null
  onSelect: (mode: TerminalAgentMode) => void
  onClose: () => void
}) {
  return (
    <ActionSheetModal
      visible={visible}
      title="Select mode"
      centerTitle
      actions={CODEX_AGENT_MODES.map((option) => ({
        label: option.label,
        hint: option.hint,
        icon: option.id === 'plan' ? ScrollText : Zap,
        selected: option.id === current,
        onPress: () => onSelect(option.id)
      }))}
      onClose={onClose}
    />
  )
}
