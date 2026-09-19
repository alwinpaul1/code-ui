import { X } from 'lucide-react-native'
import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'

/**
 * One dismissible line above the list, in two tones.
 *
 * `notice` is the default and stays neutral: the host is healthy and the user's target simply
 * went away. `failure` is for an action that did not happen, which the list has to say without
 * taking the screen: color is for state, so it is one red rule and nothing else.
 */
export function HostRouteNoticeBanner({
  message,
  tone = 'notice',
  onDismiss
}: {
  message: string
  tone?: 'notice' | 'failure'
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
        borderBottomColor: tone === 'failure' ? colors.danger : colors.border
      }}
    >
      <Txt variant="label" tone="secondary" style={{ flex: 1 }}>
        {message}
      </Txt>
      <IconButton icon={X} accessibilityLabel="Dismiss notice" onPress={onDismiss} size={36} />
    </View>
  )
}
