import { useEffect, useState } from 'react'
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { AgentType } from '../../../src/shared/agent-status-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { ViewportCentred } from './viewport-centre'
import { CLAUDE_TRANSCRIPT_LOADING, clawdLayerColor, clawdLayers, nextClawdFrame } from './claude-transcript-loading-spec'

/**
 * A Claude tab's transcript loading, as the Claude app draws a Code session's (`mu20.d`, see
 * claude-transcript-loading-spec.ts): Clawd dancing, then "Loading session…", centred on the
 * screen rather than on the chat area between the header and the composer (viewport-centre.tsx).
 *
 * Clawd is drawn from the app's own frames, one SVG path per colour, in a 55 x 17 cell
 * viewBox at 180 dp wide. The frame is plain state advanced by a timer at the app's 83 ms.
 *
 * Reduced motion: the app turns to "Still" (frame 0) when animators are off; here Clawd holds
 * frame 0 when the OS asks for reduced motion, and while the answer is not known yet, as every
 * decorative loop does (use-reduced-motion.ts).
 */
export function ClaudeTranscriptLoading() {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const still = reducedMotion !== false
  const spec = CLAUDE_TRANSCRIPT_LOADING
  const [frame, setFrame] = useState<number>(spec.stillFrame)
  useEffect(() => {
    if (still) {
      setFrame(spec.stillFrame)
      return undefined
    }
    setFrame(spec.loopFrom)
    const timer = setInterval(() => setFrame(nextClawdFrame), spec.frameMs)
    return () => clearInterval(timer)
  }, [still, spec])
  const height = (spec.width * spec.rows) / spec.columns
  return (
    <ViewportCentred testID="claude-transcript-loading">
      <View style={{ alignItems: 'center', gap: spec.gap }}>
      <View
        style={{ width: spec.width, height }}
        testID="claude-transcript-loading-clawd"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Svg width={spec.width} height={height} viewBox={`0 0 ${spec.columns} ${spec.rows}`}>
          {clawdLayers(frame).map((layer) => (
            <Path key={layer.token} d={layer.d} fill={clawdLayerColor(colors, layer)} />
          ))}
        </Svg>
      </View>
      <View style={{ paddingHorizontal: spec.labelPaddingHorizontal }}>
        <Txt variant="label" align="center">
          {spec.label}
        </Txt>
      </View>
      </View>
    </ViewportCentred>
  )
}

/** The chat's loading state before its first rows: a Claude tab gets the Claude app's Clawd,
 *  every other agent keeps the plain spinner it had. */
export function MobileNativeChatTranscriptLoading({
  agent,
  style,
  color
}: {
  agent: AgentType | null | undefined
  style: StyleProp<ViewStyle>
  color: string
}) {
  if (agent === 'claude') {
    return <ClaudeTranscriptLoading />
  }
  return (
    <ViewportCentred style={style}>
      <ActivityIndicator color={color} />
    </ViewportCentred>
  )
}
