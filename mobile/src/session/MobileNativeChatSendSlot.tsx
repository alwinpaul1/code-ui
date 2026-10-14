import { Pressable, View, type ViewStyle } from 'react-native'
import { ArrowUp, Square } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'

/**
 * The composer's trailing button: Send, or Stop while a turn runs and nothing
 * is typed. One slot, one button, as the Claude app draws it (1.261009.20,
 * decompiled: `yv8.i` picks Idle/Ready/Sending/Receiving/Interrupting, `ll`
 * case 3 maps the last two to Stop and the rest to Send, and `krz.d` shows
 * exactly one). Both of its Stop states need an empty composer, so typed text
 * brings Send back and the message queues. Both are the app's 36 dp buttons (`yg9.b`): Send a
 * white arrow on clay (`yg9.f`: `pl7.H` on `pl7.e`), Stop an outline square in the text colour on
 * the control fill (`yg9.g`: `pl7.O` on `pl7.x0`). The row's 8 dp gap spaces them from the mic.
 * Glyph sizes match what the recording of 2026-10-14 measures (arrow about 11 dp, square 14 dp).
 */
export function MobileNativeChatSendSlot({
  showStop,
  stopping,
  onStop,
  canSend,
  onSend,
  iconButton
}: {
  showStop: boolean
  stopping: boolean
  onStop?: () => void
  canSend: boolean
  onSend: () => void
  iconButton: ViewStyle
}): React.JSX.Element {
  const { colors } = useTheme()
  if (showStop) {
    return (
      <Pressable focusable={false}
        accessibilityLabel="Stop the agent"
        accessibilityRole="button"
        // Never disabled while stopping: the Claude app keeps it live and
        // swallows the repeat tap (use-chat-stop-button.ts does that here).
        accessibilityState={{ busy: stopping }}
        style={({ pressed }) => [
          iconButton,
          { backgroundColor: pressed ? colors.composerControlPressed : colors.composerControl }
        ]}
        onPress={onStop}
      >
        {stopping ? (
          // The Claude app's stopping mark (`sg4`): a 1 dp ring round the button in the content colour.
          <View
            pointerEvents="none"
            testID="native-chat-stop-ring"
            style={{
              position: 'absolute',
              width: 36,
              height: 36,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.text
            }}
          />
        ) : null}
        <Square pointerEvents="none" size={17} color={colors.text} strokeWidth={2} />
      </Pressable>
    )
  }
  return (
    <PressScale focusable={false}
      accessibilityLabel="Send message"
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSend }}
      // The clay circle always; with nothing to send its fill and its arrow each go to 40%, as
      // the Claude app draws it, not swapped for a grey one and not faded as a group.
      style={[iconButton, { backgroundColor: canSend ? colors.composerSend : colors.composerSendDisabled }]}
      pressedScale={0.9}
      onPress={onSend}
      disabled={!canSend}
    >
      <ArrowUp
        size={18}
        color={canSend ? colors.composerSendGlyph : colors.composerSendGlyphDisabled}
        strokeWidth={2.4}
      />
    </PressScale>
  )
}
