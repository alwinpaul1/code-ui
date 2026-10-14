import { useEffect, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue
} from 'react-native-reanimated'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'
import {
  appendLevelSample,
  levelSampleDue,
  waveformBar,
  waveformBarCount,
  WAVEFORM_HEIGHT,
  WAVEFORM_SAMPLE_MS,
  type LevelSample
} from './dictation-waveform-geometry'

type Props = {
  /** Microphone level 0..1, as the dictation engine reports it. */
  level: number
}

/**
 * The Claude app's dictation waveform (1.261009.20, `w330.a`): a history of the microphone level
 * that grows in from the right edge and scrolls left, one bar per 60 ms. Silence draws as round dots
 * in the secondary ink (`pl7.P`), voice as taller bars in the primary ink (`pl7.O`).
 *
 * The clock and the sampling run on the UI thread (`useFrameCallback`), and each bar's style is a
 * worklet over the shared history, so a busy JS thread does not stall the scroll. Mount it per take:
 * the history starts empty, which is what makes it grow in from the right.
 *
 * Reduced motion: the bars step one pitch per sample instead of gliding between them.
 */
export function DictationWaveform({ level }: Props): React.JSX.Element {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion() === true
  const [width, setWidth] = useState(0)
  const levelValue = useSharedValue(level)
  const history = useSharedValue<LevelSample[]>([])
  const lastSampleAt = useSharedValue(-1)
  const clock = useSharedValue(0)
  const widthValue = useSharedValue(0)
  // A shared value, not a captured boolean: the frame callback is registered once.
  const stepOnly = useSharedValue(reducedMotion)
  useEffect(() => {
    levelValue.value = level
  }, [level, levelValue])
  useEffect(() => {
    stepOnly.value = reducedMotion
  }, [reducedMotion, stepOnly])

  useFrameCallback((frame) => {
    'worklet'
    const now = frame.timeSinceFirstFrame
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
  const style = useAnimatedStyle(() => {
    const bar = waveformBar(index, history.value, clock.value, width.value, WAVEFORM_HEIGHT)
    if (bar === null) {
      return { opacity: 0, height: 0, transform: [{ translateX: 0 }, { translateY: 0 }] }
    }
    return {
      opacity: 1,
      width: bar.width,
      height: bar.height,
      borderRadius: bar.radius,
      backgroundColor: bar.voiced ? voicedColor : silentColor,
      transform: [{ translateX: bar.x }, { translateY: bar.y }]
    }
  })
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0 }, style]} />
}
