import { useState } from 'react'
import { Pressable } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'
import {
  contextRingColor,
  sessionHeaderContextReading,
  type SessionHeaderContextReading
} from './session-header-display'

/** The Claude app's XSmall circular progress: 18 dp across, a 2 dp stroke. */
const RING_SIZE = 18
const RING_STROKE = 2

/**
 * The context reading among the header's trailing actions, as the Claude app draws it (`d5a`):
 * a ring in blue, amber from 75% and red from 90%, labelled "View usage" with "N% used" as its
 * state. With tokens and no stated window it is the token count alone, never a percentage.
 *
 * Opens on touch-down, as the composer's ring did (849b0843): the header sits outside every
 * scroll, so nothing can claim the touch afterwards. `onOpen` must be idempotent, since a screen
 * reader's click arrives as a press with no press-in and a finger sends both.
 */
export function MobileSessionHeaderContextRing({
  reading,
  onOpen
}: {
  reading: Exclude<SessionHeaderContextReading, null>
  onOpen: () => void
}) {
  const { colors } = useTheme()
  const frame = {
    flexShrink: 0,
    minWidth: RING_SIZE + 12,
    height: 38,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  }
  if (reading.kind === 'tokens') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View usage"
        accessibilityValue={{ text: `${reading.usedLabel} tokens used` }}
        hitSlop={6}
        onPressIn={onOpen}
        onPress={onOpen}
        style={{ ...frame, paddingHorizontal: 4 }}
      >
        <Txt variant="label" weight="medium" tone="secondary" numberOfLines={1}>
          {reading.usedLabel}
        </Txt>
      </Pressable>
    )
  }
  const radius = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const centre = RING_SIZE / 2
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View usage"
      accessibilityValue={{ text: `${reading.percent}% used` }}
      hitSlop={10}
      onPressIn={onOpen}
      onPress={onOpen}
      style={frame}
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle cx={centre} cy={centre} r={radius} stroke={colors.border} strokeWidth={RING_STROKE} fill="none" />
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={contextRingColor(reading.step, colors)}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - reading.percent / 100)}
          rotation={-90}
          origin={`${centre}, ${centre}`}
        />
      </Svg>
    </Pressable>
  )
}

/** The header's context reading and the sheet it opens. Draws nothing when the session stated
 *  neither a figure nor its tokens (sessionHeaderContextReading says why). */
export function MobileSessionHeaderContext({
  context,
  agentStatus
}: {
  context: TerminalHudContextWindow | null
  agentStatus: AgentStatusEntry | null
}) {
  const [open, setOpen] = useState(false)
  const reading = sessionHeaderContextReading(context, agentStatus)
  return (
    <>
      {reading ? <MobileSessionHeaderContextRing reading={reading} onOpen={() => setOpen(true)} /> : null}
      <MobileContextWindowSheet
        visible={open}
        context={context}
        usedTokensLabel={reading?.kind === 'tokens' ? reading.usedLabel : null}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
