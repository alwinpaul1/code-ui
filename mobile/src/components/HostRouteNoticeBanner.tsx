import { X } from 'lucide-react-native'
import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'

// Informational, not an error: the host is healthy and the user's target simply went away,
// so this stays neutral rather than borrowing the auth-failed red.
export function HostRouteNoticeBanner({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}) {
  const { colors, space } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.bgPanel,
        paddingVertical: space.xs,
        paddingLeft: space.lg,
        paddingRight: space.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.border
      }}
    >
      <Txt variant="label" tone="secondary" style={{ flex: 1 }}>
        {message}
      </Txt>
      <IconButton icon={X} accessibilityLabel="Dismiss notice" onPress={onDismiss} size={36} />
    </View>
  )
}
