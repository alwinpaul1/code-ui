import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { Check, RotateCcw, RotateCw, X } from 'lucide-react-native'
import type { ImageMarkupPalette } from '../theme/image-markup-palette'

/** The bar comes back this long after a stroke ends (`brh.a`, 400 ms,
 *  brh.java:12; the producer is m7d case 11). */
export const MARKUP_BAR_RETURN_MS = 400
/** The Claude app's bar buttons and pill are 44 dp tall (`yg7.t(44)`,
 *  vqh.java:65, d040.java:1202) with a 24 dp glyph (vqh.java:260). */
const BAR_BUTTON = 44
const BAR_GLYPH = 24
/** Phosphor's regular weight, the family the app's glyphs come from. */
const BAR_GLYPH_STROKE = 1.5
/** The bar's padding and gaps: `j7w.k` (16, 5, 16, 5) and an 8 dp
 *  arrangement (zqh.java:110, 116). */
const BAR_PADDING_HORIZONTAL = 16
const BAR_PADDING_VERTICAL = 5
const BAR_GAP = 8
/** How long the bar takes to fade either way. The app uses Compose's default
 *  fade (`xn7.e`/`xn7.f`, zqh.java:95-96); this is close to it, not measured. */
const BAR_FADE_MS = 200

type Props = {
  palette: ImageMarkupPalette
  /** The status-bar inset the bar sits below (`wfj(.., 16)`, zqh.java:114). */
  insetTop: number
  /** Faded out and untouchable while a stroke is drawn. */
  hidden: boolean
  saving: boolean
  canUndo: boolean
  canRedo: boolean
  hasStrokes: boolean
  onClose: () => void
  onUndo: () => void
  onRedo: () => void
  onDone: () => void
}

/** The Claude app's markup bar (com.anthropic.claude 1.261013.20, the `arh`
 *  lambda in zqh.java:104-180): a row over the top of the photo holding a
 *  round Close (`d040.u`, glyph `x`), the undo | redo pill (`vqh.b`, glyphs
 *  `arrowCounterClockwise` / `arrowClockwise`), a spacer, and a round Done
 *  (`d040.v`, glyph `check`, clay) that is disabled with nothing drawn. While
 *  the picture is written, Close and Done are disabled with "Saving…" as their
 *  reason and undo/redo are disabled (vqh.b's `enabled = !saving`). */
export function ImageMarkupBar({
  palette,
  insetTop,
  hidden,
  saving,
  canUndo,
  canRedo,
  hasStrokes,
  onClose,
  onUndo,
  onRedo,
  onDone
}: Props): React.JSX.Element {
  const fade = useAnimatedStyle(() => ({
    opacity: withTiming(hidden ? 0 : 1, { duration: BAR_FADE_MS })
  }), [hidden])
  const reason = saving ? 'Saving…' : undefined
  const undoOn = !saving && canUndo
  const redoOn = !saving && canRedo
  const doneOn = !saving && hasStrokes
  return (
    <Animated.View
      testID="markup-bar"
      // Android flattens a view whose only animated style is opacity, and
      // the fade then never shows; keep this one a real view.
      collapsable={false}
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insetTop + BAR_PADDING_VERTICAL,
          paddingBottom: BAR_PADDING_VERTICAL,
          paddingHorizontal: BAR_PADDING_HORIZONTAL,
          flexDirection: 'row',
          alignItems: 'center',
          gap: BAR_GAP
        },
        fade
      ]}
    >
      <RoundBarButton accessibilityLabel="Close" onPress={onClose} enabled reason={reason} fill={palette.pill}>
        <X size={BAR_GLYPH} color={saving ? palette.glyphDisabled : palette.glyph} strokeWidth={BAR_GLYPH_STROKE} />
      </RoundBarButton>
      <View
        testID="markup-undo-redo-pill"
        style={{
          height: BAR_BUTTON,
          borderRadius: BAR_BUTTON / 2,
          backgroundColor: palette.pill,
          flexDirection: 'row',
          alignItems: 'center'
        }}
      >
        <PillButton accessibilityLabel="Undo" onPress={onUndo} enabled={undoOn}>
          <RotateCcw
            size={BAR_GLYPH}
            color={undoOn ? palette.glyph : palette.glyphDisabled}
            strokeWidth={BAR_GLYPH_STROKE}
          />
        </PillButton>
        <View testID="markup-undo-redo-divider" style={{ width: 1, height: 20, backgroundColor: palette.divider }} />
        <PillButton accessibilityLabel="Redo" onPress={onRedo} enabled={redoOn}>
          <RotateCw
            size={BAR_GLYPH}
            color={redoOn ? palette.glyph : palette.glyphDisabled}
            strokeWidth={BAR_GLYPH_STROKE}
          />
        </PillButton>
      </View>
      <View style={{ flex: 1 }} />
      <RoundBarButton accessibilityLabel="Done" onPress={onDone} enabled={hasStrokes} reason={reason} fill={palette.pill}>
        <Check size={BAR_GLYPH} color={doneOn ? palette.done : palette.glyphDisabled} strokeWidth={BAR_GLYPH_STROKE} />
      </RoundBarButton>
    </Animated.View>
  )
}

/** Whether a screen reader is on, read by the gesture without a re-render:
 *  the app keeps its bar up for one (m7d case 11, `gm0.D()`), since a bar
 *  that hides under the finger would hide from it too. */
export function useScreenReaderRef(): { readonly current: boolean } {
  const ref = useRef(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isScreenReaderEnabled?.()
      .then((enabled) => {
        if (live) {
          ref.current = enabled
        }
      })
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener?.('screenReaderChanged', (enabled: boolean) => {
      ref.current = enabled
    })
    return () => {
      live = false
      subscription?.remove()
    }
  }, [])
  return ref
}

/** The app's round bar button (`d040.v`): a 44 dp circle in the pill colour.
 *  Disabled, it keeps its fill and greys its glyph; given a reason
 *  ("Saving…") it says that instead of acting (d040.java:1129-1220, kj9). */
function RoundBarButton({
  accessibilityLabel,
  onPress,
  enabled,
  reason,
  fill,
  children
}: {
  accessibilityLabel: string
  onPress: () => void
  enabled: boolean
  reason?: string
  fill: string
  children: React.ReactNode
}) {
  const disabled = !enabled || reason !== undefined
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      accessibilityValue={reason ? { text: reason } : undefined}
      onPress={disabled ? undefined : onPress}
      style={{
        width: BAR_BUTTON,
        height: BAR_BUTTON,
        borderRadius: BAR_BUTTON / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill
      }}
    >
      {children}
    </Pressable>
  )
}

/** One half of the undo/redo pill (`vqh.d`): a 44 dp square with no fill of its own. */
function PillButton({
  accessibilityLabel,
  onPress,
  enabled,
  children
}: {
  accessibilityLabel: string
  onPress: () => void
  enabled: boolean
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
      onPress={enabled ? onPress : undefined}
      style={{ width: BAR_BUTTON, height: BAR_BUTTON, alignItems: 'center', justifyContent: 'center' }}
    >
      {children}
    </Pressable>
  )
}
