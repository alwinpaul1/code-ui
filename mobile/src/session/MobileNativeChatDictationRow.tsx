import { useEffect } from 'react'
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle
} from 'react-native-reanimated'
import { ArrowUp, Square, X } from 'lucide-react-native'
import { DictationWaveform } from '../components/DictationWaveform'
import { WAVEFORM_HEIGHT } from '../components/dictation-waveform-geometry'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import type { LevelSource } from '../dictation/pcm-level'
import { springFromAppleParams } from '../ui/alert/alert-motion'

/** Where a dictation take is, as the composer draws it. */
export type DictationRowPhase = 'off' | 'listening' | 'transcribing'

/** Which of Stop and Send ended the take: that one shows the busy ring while the words finish. */
export type DictationRowEnding = 'stop' | 'send' | null

/** The composer's swap between its text field + action row and the recording row. The Claude app
 *  animates one 0..1 fraction with a spring of ratio 1 at stiffness 400, and snaps when animations
 *  are off (1.261009.20, `hb8` case 0 via `x030.b`; `nom.y` reads the animator setting). */
export const DICTATION_ROW_SPRING = springFromAppleParams({
  dampingRatio: 1,
  response: (2 * Math.PI) / Math.sqrt(400)
})

/** The centre's waveform ↔ "Transcribing…" swap, Compose's default Crossfade (`krz.a`, *inferred*:
 *  no spec is passed, so tween 300 ms). */
export const DICTATION_CENTRE_CROSSFADE_MS = 300

/** A button that cannot be pressed while the words finish draws at 38% (`kcw.e`: container and
 *  content colours at 0.38 alpha). */
export const DICTATION_BUTTON_DISABLED_OPACITY = 0.38

/** Spacing between the row's three parts (`kcw.f`: a Row with 12 dp spacing). */
const ROW_GAP = 12

/**
 * The composer's recording row, after the Claude app's speech toolbar (1.261009.20, `kcw.f`):
 * Cancel on the left, the waveform in the middle, Stop dictation and Send dictation on the right.
 * Cancel and Stop are the composer's grey control circle with the ink glyph (`pl7.x0` / `pl7.O`),
 * Send the accent circle with the on-accent arrow (`pl7.e` / `pl7.H`).
 *
 * While the words finish ("transcribing"), the centre crossfades to "Transcribing…"; Cancel stays
 * live; the button that ended the take shows a busy ring and the other dims to 38%.
 */
export function MobileNativeChatDictationRow({
  phase,
  ending,
  sendBlocked = false,
  level,
  levelSource,
  onCancel,
  onStop,
  onSend,
  iconButton
}: {
  phase: DictationRowPhase
  ending: DictationRowEnding
  /** The composer's send would refuse now: Send greys, as the composer's Send does, rather than
   *  stop the take and drop the send without a word. Stop and Cancel stay. */
  sendBlocked?: boolean
  level: number
  /** The engine's per-chunk level, when it has one (DictationWaveform). */
  levelSource?: LevelSource
  onCancel: () => void
  onStop: () => void
  onSend: () => void
  iconButton: ViewStyle
}): React.JSX.Element {
  const { colors, fonts, type } = useTheme()
  const reducedMotion = useReducedMotion() === true
  const transcribing = phase === 'transcribing'
  // The centre's crossfade. It keeps its last side while the row fades out, so the row leaves with
  // what it showed.
  const centre = useSharedValue(transcribing ? 1 : 0)
  useEffect(() => {
    if (phase === 'off') {
      return
    }
    const target = transcribing ? 1 : 0
    centre.value = reducedMotion
      ? target
      : withTiming(target, { duration: DICTATION_CENTRE_CROSSFADE_MS, easing: Easing.out(Easing.cubic) })
  }, [centre, phase, reducedMotion, transcribing])
  const waveformStyle = useAnimatedStyle(() => ({ opacity: 1 - centre.value }))
  const labelStyle = useAnimatedStyle(() => ({ opacity: centre.value }))

  const busy = (which: Exclude<DictationRowEnding, null>): boolean => transcribing && ending === which
  const dimmed = (which: Exclude<DictationRowEnding, null>): boolean => transcribing && ending !== which
  const control = (pressed: boolean): ViewStyle => ({
    backgroundColor: pressed ? colors.composerControlPressed : colors.composerControl
  })

  return (
    <View
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: ROW_GAP }}
      testID="native-chat-dictation-row"
    >
      <Pressable
        focusable={false}
        accessibilityLabel="Cancel"
        accessibilityRole="button"
        style={({ pressed }) => [iconButton, control(pressed)]}
        onPress={onCancel}
      >
        <X pointerEvents="none" size={20} color={colors.text} strokeWidth={2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, height: WAVEFORM_HEIGHT, justifyContent: 'center' }}>
        {phase === 'off' ? null : (
          <Animated.View style={[{ flex: 1, flexDirection: 'row' }, waveformStyle]} testID="dictation-waveform-fade">
            <DictationWaveform level={transcribing ? 0 : level} levelSource={transcribing ? undefined : levelSource} />
          </Animated.View>
        )}
        <Animated.View
          pointerEvents="none"
          importantForAccessibility={transcribing ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!transcribing}
          style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }, labelStyle]}
        >
          <Text
            numberOfLines={1}
            style={{
              color: colors.textSecondary,
              fontFamily: fonts.regular,
              fontSize: type.label.size,
              lineHeight: type.label.lineHeight
            }}
          >
            Transcribing…
          </Text>
        </Animated.View>
      </View>
      <Pressable
        focusable={false}
        accessibilityLabel="Stop dictation"
        accessibilityRole="button"
        accessibilityState={{ disabled: transcribing, busy: busy('stop') }}
        disabled={transcribing}
        style={({ pressed }) => [
          iconButton,
          control(pressed),
          { opacity: dimmed('stop') ? DICTATION_BUTTON_DISABLED_OPACITY : 1 }
        ]}
        onPress={onStop}
      >
        {busy('stop') ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Square pointerEvents="none" size={14} color={colors.text} strokeWidth={2.4} fill={colors.text} />
        )}
      </Pressable>
      <Pressable
        focusable={false}
        accessibilityLabel="Send dictation"
        accessibilityRole="button"
        accessibilityState={{ disabled: transcribing || sendBlocked, busy: busy('send') }}
        disabled={transcribing || sendBlocked}
        style={[
          iconButton,
          {
            backgroundColor: colors.accent,
            opacity: dimmed('send') || (sendBlocked && !busy('send')) ? DICTATION_BUTTON_DISABLED_OPACITY : 1
          }
        ]}
        onPress={onSend}
      >
        {busy('send') ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <ArrowUp pointerEvents="none" size={19} color={colors.onAccent} strokeWidth={2.6} />
        )}
      </Pressable>
    </View>
  )
}

/**
 * The recording row laid over the composer's action row, not instead of it: the row underneath
 * keeps its buttons mounted, so a held mic keeps its touch (its removal would lose the release) and
 * the swap is a crossfade. Drawn after the action row, so it is on top and takes every touch while
 * it is up; with the take over it lets touches through and hides from a screen reader.
 */
export function MobileNativeChatDictationLayer({
  row,
  level,
  levelSource,
  padding,
  iconButton
}: {
  row: {
    up: boolean
    phase: DictationRowPhase
    ending: DictationRowEnding
    sendBlocked: boolean
    layerStyle: StyleProp<AnimatedStyle<ViewStyle>>
    cancel: () => void
    stop: () => void
    send: () => void
  }
  level: number
  levelSource?: LevelSource
  padding: number
  iconButton: ViewStyle
}): React.JSX.Element {
  const { up } = row
  return (
    <Animated.View
      pointerEvents={up ? 'auto' : 'none'}
      importantForAccessibility={up ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!up}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: padding,
          paddingBottom: padding
        },
        row.layerStyle
      ]}
      testID="native-chat-dictation-layer"
    >
      <MobileNativeChatDictationRow
        phase={row.phase}
        ending={row.ending}
        sendBlocked={row.sendBlocked}
        level={level}
        levelSource={levelSource}
        onCancel={row.cancel}
        onStop={row.stop}
        onSend={row.send}
        iconButton={iconButton}
      />
    </Animated.View>
  )
}
