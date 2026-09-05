import { ChevronRight } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'

export function HostDiagnosticsLink({ onPress }: { onPress: () => void }): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  return (
    <PressScale
      style={{
        marginHorizontal: space.lg,
        marginVertical: space.sm,
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View network diagnostics"
    >
      <Txt variant="label" weight="semibold" tone="secondary">
        View network diagnostics
      </Txt>
      <ChevronRight size={16} color={colors.textSecondary} />
    </PressScale>
  )
}
