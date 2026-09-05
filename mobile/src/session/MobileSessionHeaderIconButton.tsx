import type { LucideIcon } from 'lucide-react-native'
import { IconButton } from '../ui/IconButton'

type MobileSessionHeaderIconButtonProps = {
  active?: boolean
  accessibilityLabel: string
  icon: LucideIcon
  onPress: () => void
  disabled?: boolean
}

export function MobileSessionHeaderIconButton({
  active = false,
  accessibilityLabel,
  icon,
  onPress,
  disabled = false
}: MobileSessionHeaderIconButtonProps) {
  return (
    <IconButton
      icon={icon}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      active={active}
      disabled={disabled}
      size={38}
      iconSize={18}
    />
  )
}
