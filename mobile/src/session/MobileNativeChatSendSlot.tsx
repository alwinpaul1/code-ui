import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native'
import { ArrowUp, Square } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { COMPOSER_BUTTON_HIT_SLOP } from './composer-touch-target'

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
 *
 * `sending`: a send is in flight. The app's composer hands its button `Send(enabled, processing)`
 * (1.261013.20, `j28` at ui7.java:150 into `oj9.f`), and processing draws a progress ring in the
 * button in place of the arrow until the post returns. The circle stays clay and takes no tap.
 */
export function MobileNativeChatSendSlot({
  showStop,
  stopping,
  onStop,
  canSend,
  sending = false,
  onSend,
  iconButton
}: {
  showStop: boolean
  stopping: boolean
  onStop?: () => void
  canSend: boolean
  /** A send is in flight: the ring in place of the arrow (Claude tabs only, the composer decides). */
  sending?: boolean
  onSend: () => void
  iconButton: ViewStyle
}): React.JSX.Element {
  const { colors } = useTheme()
  if (showStop) {
    return (
      <Pressable focusable={false}
        hitSlop={COMPOSER_BUTTON_HIT_SLOP}
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
      hitSlop={COMPOSER_BUTTON_HIT_SLOP}
      accessibilityLabel="Send message"
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSend, busy: sending }}
      // The clay circle always; with nothing to send its fill and its arrow each go to 40%, as
      // the Claude app draws it, not swapped for a grey one and not faded as a group.
      style={[iconButton, { backgroundColor: canSend || sending ? colors.composerSend : colors.composerSendDisabled }]}
      pressedScale={0.9}
      onPress={onSend}
      disabled={!canSend}
    >
      {sending ? (
        <ActivityIndicator testID="native-chat-send-ring" size="small" color={colors.composerSendGlyph} />
      ) : (
        <ArrowUp
          size={18}
          color={canSend ? colors.composerSendGlyph : colors.composerSendGlyphDisabled}
          strokeWidth={2.4}
        />
      )}
    </PressScale>
  )
}
