import { useEffect, useState } from 'react'
import { Animated, Easing, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { ROLLING_FADE_MS, ROLLING_SPRING, rollingSlots, rollsUpward } from './claude-rolling-text'

/**
 * A line whose figures roll as the Claude app's do (`z530.a`; claude-rolling-text.ts): each digit
 * sits in a slot as wide as the widest digit, so "9s" to "10s" does not shift the words after it,
 * and a digit that changes slides in from below while the old one slides out above (the other
 * way when the figure went down). Under reduced motion the new digit is simply drawn.
 */
export function ClaudeRollingText({
  text,
  style,
  testID
}: {
  text: string
  style: StyleProp<TextStyle>
  testID?: string
}) {
  const reducedMotion = useReducedMotion()
  const [digitWidth, setDigitWidth] = useState<number | null>(null)
  // Which way this change rolls, decided once per new text (React's adjust-while-rendering).
  const [last, setLast] = useState({ text, upward: true })
  if (last.text !== text) {
    setLast({ text, upward: rollsUpward(last.text, text, last.upward) })
  }
  const upward = last.upward
  const lineHeight = (Array.isArray(style) ? Object.assign({}, ...style) : (style as TextStyle | undefined))?.lineHeight ?? 21
  return (
    <View style={{ flexDirection: 'row', flexShrink: 1 }} accessible accessibilityLabel={text} testID={testID}>
      {/* The widest digit in this style, measured once: the slot every digit is drawn in. */}
      <Text
        style={[style, { position: 'absolute', opacity: 0 }]}
        onTextLayout={(event) => {
          const widest = Math.max(...event.nativeEvent.lines.map((line) => line.width))
          if (Number.isFinite(widest) && widest > 0 && widest !== digitWidth) {
            setDigitWidth(widest)
          }
        }}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {'0\n1\n2\n3\n4\n5\n6\n7\n8\n9'}
      </Text>
      {rollingSlots(text).map((slot) =>
        slot.digit ? (
          <RollingDigit
            key={slot.key}
            ch={slot.ch}
            upward={upward}
            width={digitWidth}
            height={lineHeight}
            style={style}
            still={reducedMotion !== false}
          />
        ) : (
          <Text key={slot.key} style={style} numberOfLines={1}>
            {slot.ch}
          </Text>
        )
      )}
    </View>
  )
}

function RollingDigit({
  ch,
  upward,
  width,
  height,
  style,
  still
}: {
  ch: string
  upward: boolean
  width: number | null
  height: number
  style: StyleProp<TextStyle>
  still: boolean
}) {
  const [shown, setShown] = useState({ ch, leaving: null as string | null })
  const [progress] = useState(() => new Animated.Value(1))
  const [fade] = useState(() => new Animated.Value(1))
  if (shown.ch !== ch) {
    setShown({ ch, leaving: still ? null : shown.ch })
  }
  useEffect(() => {
    if (shown.leaving === null) {
      return undefined
    }
    progress.setValue(0)
    fade.setValue(0)
    const motion = Animated.parallel([
      Animated.spring(progress, { toValue: 1, ...ROLLING_SPRING, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: ROLLING_FADE_MS, easing: Easing.linear, useNativeDriver: true })
    ])
    motion.start(({ finished }) => {
      if (finished) {
        setShown((current) => ({ ch: current.ch, leaving: null }))
      }
    })
    return () => motion.stop()
  }, [shown, progress, fade])
  const slot = { width: width ?? undefined, alignItems: 'center' as const }
  if (shown.leaving === null) {
    return (
      <View style={slot}>
        <Text style={style}>{ch}</Text>
      </View>
    )
  }
  const sign = upward ? 1 : -1
  return (
    <View style={slot}>
      <Animated.Text
        style={[
          style,
          {
            position: 'absolute',
            opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -sign * height] }) }]
          }
        ]}
      >
        {shown.leaving}
      </Animated.Text>
      <Animated.Text
        style={[
          style,
          {
            opacity: fade,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [sign * height, 0] }) }]
          }
        ]}
      >
        {ch}
      </Animated.Text>
    </View>
  )
}
