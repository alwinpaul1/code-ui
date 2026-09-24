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
 *
 * Both are inserted into a screen that is already on screen, so a reader who has moved past the top
 * of the list never arrives at one. The tone decides how loudly it is carried to them: a refusal
 * interrupts, and a bounced route waits its turn, because interrupting for the second would train
 * people to ignore the first. `alert` only for the refusal, and no role for the other — React
 * Native has no `status` role, so the polite region is the whole of that answer.
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
      accessibilityRole={tone === 'failure' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'failure' ? 'assertive' : 'polite'}
    >
      <Txt variant="label" tone="secondary" style={{ flex: 1 }}>
        {message}
      </Txt>
      <IconButton icon={X} accessibilityLabel="Dismiss notice" onPress={onDismiss} size={36} />
    </View>
  )
}
