import { useEffect, useState } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Ellipse, G } from 'react-native-svg'
import { useReducedMotion } from '../ui/use-reduced-motion'
import {
  WORKING_MARK,
  retargetWorkingMark,
  workingMarkFadeIn,
  workingMarkFrameAt,
  workingMarkFrameColor,
  workingMarkShapes,
  workingMarkStillFrame,
  type WorkingMarkFade,
  type WorkingMarkFrame,
  type WorkingMarkKind,
  type WorkingMarkPlayer
} from './claude-working-mark'

/**
 * The Claude app's working mark beside the working footer: a 20 dp box of dots that open, loop
 * and close, picked by what the turn is doing (claude-working-mark.ts has the decompile's lines).
 * It replaced the 16 dp asterisk sprite, which the app no longer ships.
 *
 * A timer at the app's 30 frames a second re-reads the player; each tick draws at most a handful
 * of circles. Reduced motion (and the moment before the OS has answered) draws the kind's resting
 * frame and starts no timer, as the app does with its own motion switch off.
 */
export function ClaudeWorkingMark({ color, kind }: { color: string; kind: WorkingMarkKind }) {
  const reducedMotion = useReducedMotion()
  const still = reducedMotion !== false
  // The clock the timer ticks: the time of the last frame drawn.
  const [now, setNow] = useState(() => Date.now())
  // The player and its fade are state, re-aimed during render when the kind or the motion
  // setting changes (React's "adjust state while rendering" pattern), so the first frame drawn is
  // already the right one and no effect runs a frame late. It is re-aimed at the last tick's time,
  // at most one frame (33 ms) old, so rendering stays pure.
  const [mark, setMark] = useState<{ kind: WorkingMarkKind; still: boolean; player: WorkingMarkPlayer | null; fade: WorkingMarkFade | null }>(
    () => ({ kind, still, player: still ? null : retargetWorkingMark(null, kind, Date.now()).player, fade: null })
  )
  if (mark.kind !== kind || mark.still !== still) {
    if (still) {
      setMark({ kind, still, player: null, fade: null })
    } else {
      const { player, fade } = retargetWorkingMark(mark.player, kind, now)
      setMark({ kind, still, player, fade: fade ?? mark.fade })
    }
  }

  useEffect(() => {
    if (still) {
      return undefined
    }
    const timer = setInterval(() => setNow(Date.now()), WORKING_MARK.frameMs)
    return () => clearInterval(timer)
  }, [still])

  const size = WORKING_MARK.size
  let layers: { frame: WorkingMarkFrame; opacity: number }[]
  if (mark.player === null) {
    layers = [{ frame: workingMarkStillFrame(kind), opacity: 1 }]
  } else {
    const at = Math.max(now, mark.player.stageStart)
    const current = workingMarkFrameAt(mark.player, at)
    const fadeIn = workingMarkFadeIn(mark.fade, at)
    layers =
      fadeIn === null || mark.fade === null
        ? [{ frame: current, opacity: 1 }]
        : [
            { frame: mark.fade.from, opacity: 1 - fadeIn },
            { frame: current, opacity: fadeIn }
          ]
  }
  return (
    <View
      style={{ width: size, height: size }}
      testID="claude-working-mark"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg width={size} height={size} viewBox="0 0 1000 1000">
        {layers.map(({ frame, opacity }, layer) => {
          const fill = workingMarkFrameColor(frame) ?? color
          return (
            <G key={layer} opacity={opacity} testID="claude-working-mark-frame" data-frame={frame.index}>
              {workingMarkShapes(frame).map((shape, i) => {
                switch (shape.kind) {
                  case 'dot':
                    return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} />
                  case 'ring':
                    return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill="none" stroke={fill} strokeWidth={shape.width} />
                  case 'ellipse':
                    return (
                      <Ellipse
                        key={i}
                        cx={shape.cx}
                        cy={shape.cy}
                        rx={shape.rx}
                        ry={shape.ry}
                        fill={fill}
                        transform={`rotate(${shape.degrees} ${shape.cx} ${shape.cy})`}
                      />
                    )
                  default: {
                    const unknown: never = shape
                    throw new Error(`unknown working-mark shape ${JSON.stringify(unknown)}`)
                  }
                }
              })}
            </G>
          )
        })}
      </Svg>
    </View>
  )
}
