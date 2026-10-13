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
 * brings Send back and the message queues. Sizes and colours are Code UI's: the
 * 36 dp circle of + and the mic, and the danger tone the old status-line Stop had.
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
  const { colors, space } = useTheme()
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
          { marginLeft: space.xs, backgroundColor: pressed ? colors.composerControlPressed : colors.composerControl }
        ]}
        onPress={onStop}
      >
        {stopping ? (
          // The Claude app's stopping mark: a thin ring round the button.
          <View
            pointerEvents="none"
            testID="native-chat-stop-ring"
            style={{
              position: 'absolute',
              width: 36,
              height: 36,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.danger
            }}
          />
        ) : null}
        <Square pointerEvents="none" size={14} color={colors.danger} strokeWidth={2.4} fill={colors.danger} />
      </Pressable>
    )
  }
  return (
    <PressScale focusable={false}
      accessibilityLabel="Send message"
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSend }}
      // Extra margin: two filled circles on the row's 4 px gap read as one blob.
      // The accent circle always; with nothing to send it is dimmed, as the
      // Claude app draws it, not swapped for a grey one.
      style={[iconButton, { marginLeft: space.xs, backgroundColor: colors.accent, opacity: canSend ? 1 : 0.4 }]}
      pressedScale={0.9}
      onPress={onSend}
      disabled={!canSend}
    >
      <ArrowUp
        size={19}
        color={colors.onAccent}
        strokeWidth={2.6}
      />
    </PressScale>
  )
}
