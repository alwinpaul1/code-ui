import { SquareChevronRight } from 'lucide-react-native'
import { IconButton } from '../ui/IconButton'

type Props = {
  disabled: boolean
  onPress: () => void
}

export function QuickCommandsTabButton({ disabled, onPress }: Props) {
  return (
    <IconButton
      icon={SquareChevronRight}
      accessibilityLabel="Quick commands"
      disabled={disabled}
      onPress={onPress}
      size={36}
      iconSize={17}
    />
  )
}
