import { useEffect, useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { CLAUDE_TRANSCRIPT_LOADING, clawdLayerColor, clawdLayers, nextClawdFrame } from './claude-transcript-loading-spec'

/**
 * Clawd dancing, from the Claude app's own frames (claude-transcript-loading-spec.ts): one SVG
 * path per colour in a 55 x 17 cell viewBox at 180 dp wide, advanced by a timer at the app's 83 ms.
 * `still` holds frame 0 (reduced motion, or a loader that has stopped waiting).
 */
export function ClawdDancing(props: { still: boolean; testID: string }) {
  const { colors } = useTheme()
  const spec = CLAUDE_TRANSCRIPT_LOADING
  const [frame, setFrame] = useState<number>(spec.stillFrame)
  useEffect(() => {
    if (props.still) {
      setFrame(spec.stillFrame)
      return undefined
    }
    setFrame(spec.loopFrom)
    const timer = setInterval(() => setFrame(nextClawdFrame), spec.frameMs)
    return () => clearInterval(timer)
  }, [props.still, spec])
  const height = (spec.width * spec.rows) / spec.columns
  return (
    <View
      style={{ width: spec.width, height }}
      testID={props.testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg width={spec.width} height={height} viewBox={`0 0 ${spec.columns} ${spec.rows}`}>
        {clawdLayers(frame).map((layer) => (
          <Path key={layer.token} d={layer.d} fill={clawdLayerColor(colors, layer)} />
        ))}
      </Svg>
    </View>
  )
}
