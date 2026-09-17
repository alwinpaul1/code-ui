import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'

/** The default press-state: the control dims. Works on any fill, any palette,
 *  either colour scheme, so a caller that passes nothing still acknowledges
 *  the finger. 0.7 is what the app's hand-written `pressed ?` styles settled
 *  on most often; the send button in tasks uses 0.75 and IconButton 0.85
 *  under a scale. */
export const PRESS_DIM_STYLE: ViewStyle = { opacity: 0.7 }

export type PressFeedbackProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
  /** What changes while the finger is down. A full-width row lifts its
   *  background (`{ backgroundColor }`); a control with its own fill or
   *  border dims (the default). */
  pressedStyle?: StyleProp<ViewStyle>
}

/**
 * A Pressable that always acknowledges the press, on the way DOWN.
 *
 * `Pressable`'s style function runs with `pressed: true` the moment the
 * finger lands and `false` when it lifts or drags out of the retention
 * offset, so the surface changes at once and a drag-away clears it without
 * committing. A static `style={styles.row}` shows nothing until the
 * handler's async result lands, which on the tasks surface was a network
 * round trip: the user tapped, saw nothing, and tapped again.
 *
 * This is the sibling of `PressScale` for surfaces that must not scale: a
 * row in a list, a segment in a bar, a chip in a wrap. `disabled` needs no
 * guard here; RN's Pressable never enters the pressed state while disabled.
 */
export function PressFeedback({ style, pressedStyle = PRESS_DIM_STYLE, ...rest }: PressFeedbackProps) {
  return <Pressable {...rest} style={({ pressed }) => [style, pressed ? pressedStyle : null]} />
}
