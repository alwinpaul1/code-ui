import { Plus } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'

// Diameter of the phone "new workspace" floating action button. Exported so the
// worktree list can reserve matching bottom padding and keep the last row tappable.
export const FAB_SIZE = 54

type NewWorkspaceFabProps = {
  onPress: () => void
  disabled?: boolean
}

// Phone-only floating "+" for creating a workspace. Absolutely positioned so it
// never intercepts list row taps, and lifted above the home indicator.
export function NewWorkspaceFab({ onPress, disabled }: NewWorkspaceFabProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel="New workspace"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      haptic
      pressedScale={0.92}
      style={{
        position: 'absolute',
        right: space.lg,
        bottom: space.xl + insets.bottom,
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: FAB_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accent,
        shadowColor: colors.shadow,
        shadowOpacity: 1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        opacity: disabled ? 0.5 : 1
      }}
    >
      <Plus size={26} color={colors.onAccent} strokeWidth={2.5} />
    </PressScale>
  )
}
