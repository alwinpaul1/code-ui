import { Check, Circle } from 'lucide-react-native'
import type { ComputerAwakeMode } from '../../../src/shared/computer-awake-mode'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useTheme } from '../theme/theme-context'
import { COMPUTER_AWAKE_OPTIONS } from './mobile-computer-awake'

type Props = {
  visible: boolean
  mode: ComputerAwakeMode | null
  saving: boolean
  error: string | null
  onSelect: (mode: ComputerAwakeMode) => void
  onClose: () => void
}

/** On / Agent / Off picker, the phone's copy of Orca's keep-awake popover. */
export function MobileComputerAwakeSheet({
  visible,
  mode,
  saving,
  error,
  onSelect,
  onClose
}: Props) {
  const { colors } = useTheme()
  return (
    <ActionSheetModal
      visible={visible}
      title="Keep computer awake"
      message={error ?? 'Applies to the Mac running Orca'}
      actions={COMPUTER_AWAKE_OPTIONS.map((option) => {
        const selected = option.mode === mode
        return {
          label: option.label,
          hint: option.hint,
          loading: saving && selected,
          renderIcon: () =>
            selected ? (
              <Check size={17} color={colors.accent} strokeWidth={2.4} />
            ) : (
              <Circle size={17} color={colors.textMuted} strokeWidth={1.6} />
            ),
          onPress: () => onSelect(option.mode)
        }
      })}
      onClose={onClose}
    />
  )
}
