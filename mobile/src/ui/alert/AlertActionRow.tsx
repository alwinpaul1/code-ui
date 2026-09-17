import { Pressable, StyleSheet } from 'react-native'

import { useTheme } from '../../theme/theme-context'
import { Txt } from '../Txt'

/** UIAlertController's row height. Also the minimum tap target. */
export const ALERT_ACTION_ROW_HEIGHT = 44

type Props = {
  label: string
  onPress: () => void
  /** The action the alert is for (Update now, Install, OK): semibold, the way
   *  UIAlertController draws its preferredAction. At most one per alert. */
  preferred?: boolean
  destructive?: boolean
}

/**
 * One full-width action under an alert's message, separated from the row
 * above by a hairline. Not a `Button`: a system alert's actions are rows of
 * the card, not pills inside it.
 *
 * Feedback is on the PRESS, not the release. A Pressable's style function
 * runs with `pressed: true` the moment the finger lands and `false` again
 * when it lifts or drags past the retention offset, so the row highlights at
 * once and a drag-away clears it without committing. A static style, or a
 * highlight set from `onPress`, would only show something after the finger
 * had already left.
 */
export function AlertActionRow({ label, onPress, preferred = false, destructive = false }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        // A minimum, not a height: at a large font size the label grows and
        // the row grows with it rather than clipping. Never shrinks: when the
        // card is taller than the screen it is the scroll region above that
        // gives way, so the rows stay reachable.
        minHeight: ALERT_ACTION_ROW_HEIGHT,
        flexShrink: 0,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.alertSeparator,
        backgroundColor: pressed ? colors.alertRowPressed : 'transparent'
      })}
    >
      <Txt
        variant="heading"
        weight={preferred ? 'semibold' : 'regular'}
        tone={destructive ? 'danger' : 'accent'}
        align="center"
      >
        {label}
      </Txt>
    </Pressable>
  )
}
