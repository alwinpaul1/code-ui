import { useEffect, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue
} from 'react-native-reanimated'
import { useTheme } from '../theme/theme-context'
import type { LevelSource } from '../dictation/pcm-level'
import { useReducedMotion } from '../ui/use-reduced-motion'
import {
  appendLevelSample,
  levelSampleDue,
  waveformBar,
  waveformBarCount,
  waveformBarParts,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_HEIGHT,
  WAVEFORM_SAMPLE_MS,
  type LevelSample
} from './dictation-waveform-geometry'

type Props = {
  /** Microphone level 0..1, as the dictation engine reports it. */
  level: number
  /** A level that changes per audio chunk, held outside React (the Anthropic engine's). When
   *  given it wins over `level`, and its changes reach the UI thread without a render. */
  levelSource?: LevelSource
}

/**
 * The Claude app's dictation waveform (1.261009.20, `w330.a`): a history of the microphone level
 * that grows in from the right edge and scrolls left, one bar per 60 ms. Silence draws as round dots
 * in the secondary ink (`pl7.P`), voice as taller bars in the primary ink (`pl7.O`).
 *
 * The clock and the sampling run on the UI thread (`useFrameCallback`), and each bar's style is a
 * worklet over the shared history, so a busy JS thread does not stall the scroll. Claude paints
 * every bar in one Canvas pass, so a bar's height and position cannot disagree; here each bar is
 * views laid out once and moved only by transforms (`waveformBarParts`), so they reach the screen
 * together. Animating `height` beside a transform shivered (0.9.157, 2026-10-17). Mount it per take:
 * the history starts empty, which is what makes it grow in from the right.
 *
 * Reduced motion: the bars step one pitch per sample instead of gliding between them.
 */
export function DictationWaveform({ level, levelSource }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion() === true
  const [width, setWidth] = useState(0)
  const levelValue = useSharedValue(level)
  const history = useSharedValue<LevelSample[]>([])
  const lastSampleAt = useSharedValue(-1)
  const clock = useSharedValue(0)
  /** The first frame's timestamp, -1 until it comes. Per mount, so a new take starts empty. */
  const takeStart = useSharedValue(-1)
  const widthValue = useSharedValue(0)
  // A shared value, not a captured boolean: the frame callback is registered once.
  const stepOnly = useSharedValue(reducedMotion)
  useEffect(() => {
    if (!levelSource) {
      levelValue.value = level
    }
  }, [level, levelSource, levelValue])
  useEffect(() => {
    if (!levelSource) {
      return undefined
    }
    levelValue.value = levelSource.current
    return levelSource.subscribe((next) => {
      levelValue.value = next
    })
  }, [levelSource, levelValue])
  useEffect(() => {
    stepOnly.value = reducedMotion
  }, [reducedMotion, stepOnly])

  useFrameCallback((frame) => {
    'worklet'
    // The take's own clock, from the frame's timestamp and a start kept in a shared value. Not
    // `timeSinceFirstFrame`: Reanimated re-registers this callback on every render (its effect is
    // keyed on the callback), which restarts that at 0, and each caption word re-renders the
    // composer, so the history kept starting again (device, 0.9.143). Claude's is the system
    // clock (w330.a, `SystemClock.elapsedRealtime`).
    if (takeStart.value < 0) {
      takeStart.value = frame.timestamp
    }
    const now = frame.timestamp - takeStart.value
    const due = levelSampleDue(lastSampleAt.value < 0 ? null : lastSampleAt.value, now)
    if (due !== null) {
      history.value = appendLevelSample(history.value, levelValue.value, due)
      lastSampleAt.value = due
    }
    clock.value = stepOnly.value ? now - (now % WAVEFORM_SAMPLE_MS) : now
  })

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width
    widthValue.value = next
    setWidth(next)
  }
  const count = waveformBarCount(width)
  const bars: React.JSX.Element[] = []
  for (let i = 0; i < count; i++) {
    bars.push(
      <WaveformBarView
        key={i}
        index={i}
        history={history}
        clock={clock}
        width={widthValue}
        voicedColor={colors.text}
        silentColor={colors.textSecondary}
      />
    )
  }
  return (
    <View
      accessibilityLabel="Listening"
      onLayout={onLayout}
      style={{ flex: 1, minWidth: 0, height: WAVEFORM_HEIGHT, overflow: 'hidden' }}
      testID="dictation-waveform"
    >
      {bars}
    </View>
  )
}

/** A bar's three parts, laid out once and moved only by transforms (`waveformBarParts`). */
const CAP_TOP = (WAVEFORM_HEIGHT - WAVEFORM_BAR_WIDTH) / 2
const capLayout = {
  position: 'absolute',
  left: 0,
  top: CAP_TOP,
  width: WAVEFORM_BAR_WIDTH,
  height: WAVEFORM_BAR_WIDTH,
  borderRadius: WAVEFORM_BAR_WIDTH / 2
} as const
const bodyLayout = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: WAVEFORM_BAR_WIDTH,
  height: WAVEFORM_HEIGHT
} as const
const barLayout = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: WAVEFORM_BAR_WIDTH,
  height: WAVEFORM_HEIGHT
} as const

function WaveformBarView({
  index,
  history,
  clock,
  width,
  voicedColor,
  silentColor
}: {
  index: number
  history: SharedValue<LevelSample[]>
  clock: SharedValue<number>
  width: SharedValue<number>
  voicedColor: string
  silentColor: string
}): React.JSX.Element {
  const bar = useDerivedValue(
    () => waveformBar(index, history.value, clock.value, width.value, WAVEFORM_HEIGHT),
    [index, history, clock, width]
  )
  // Every style below is opacity, colour or a transform: props Reanimated hands to the view in one
  // pass. No width, height or top is animated (see waveformBarParts for why).
  const barStyle = useAnimatedStyle(() => {
    const b = bar.value
    return b === null
      ? { opacity: 0, transform: [{ translateX: 0 }] }
      : { opacity: 1, transform: [{ translateX: b.x }] }
  }, [bar])
  const topCapStyle = useAnimatedStyle(() => {
    const b = bar.value
    const parts = waveformBarParts(b === null ? 0 : b.height, WAVEFORM_HEIGHT)
    return {
      backgroundColor: b !== null && b.voiced ? voicedColor : silentColor,
      transform: [{ translateY: -parts.capOffset }, { scaleY: parts.capScaleY }]
    }
  }, [bar, voicedColor, silentColor])
  const bottomCapStyle = useAnimatedStyle(() => {
    const b = bar.value
    const parts = waveformBarParts(b === null ? 0 : b.height, WAVEFORM_HEIGHT)
    return {
      backgroundColor: b !== null && b.voiced ? voicedColor : silentColor,
      transform: [{ translateY: parts.capOffset }, { scaleY: parts.capScaleY }]
    }
  }, [bar, voicedColor, silentColor])
  const bodyStyle = useAnimatedStyle(() => {
    const b = bar.value
    const parts = waveformBarParts(b === null ? 0 : b.height, WAVEFORM_HEIGHT)
    return {
      backgroundColor: b !== null && b.voiced ? voicedColor : silentColor,
      transform: [{ scaleY: parts.bodyScaleY }]
    }
  }, [bar, voicedColor, silentColor])
  // collapsable={false}: a view with only a transform and opacity is otherwise flattened away on
  // Android, and the animation would have no view to move.
  return (
    <Animated.View collapsable={false} pointerEvents="none" style={[barLayout, barStyle]}>
      <Animated.View style={[bodyLayout, bodyStyle]} />
      <Animated.View style={[capLayout, topCapStyle]} />
      <Animated.View style={[capLayout, bottomCapStyle]} />
    </Animated.View>
  )
}
