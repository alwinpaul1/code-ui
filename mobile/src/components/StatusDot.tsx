import { View, StyleSheet } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { StatusPulse } from '../ui/StatusPulse'
import type { ConnectionState } from '../transport/types'
import type { ConnectionVerdict } from '../transport/connection-health'
import { CONNECTION_STATE_TONES, statusTone, type StatusTone } from './status-dot-tone'

export { statusDotColor, statusTone } from './status-dot-tone'
export type { StatusTone } from './status-dot-tone'

export function useStatusColor(state: ConnectionState, verdict?: ConnectionVerdict): string {
  const { colors } = useTheme()
  const tone: StatusTone = statusTone(state, verdict)
  switch (tone) {
    case 'success':
      return colors.success
    case 'warning':
      return colors.warning
    case 'danger':
      return colors.danger
    case 'muted':
      return colors.textMuted
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

/** Connection dot. Transitional states (connecting, reconnecting) pulse so a
 *  stuck reconnect is visibly different from a settled disconnect. */
export function StatusDot({
  state,
  verdict,
  size = 8,
  gap = true
}: {
  state: ConnectionState
  verdict?: ConnectionVerdict
  size?: number
  /** Legacy right margin; new layouts use flex `gap` and pass false. */
  gap?: boolean
}) {
  const color = useStatusColor(state, verdict)
  const pulse =
    CONNECTION_STATE_TONES[state] === 'warning' && statusTone(state, verdict) !== 'danger'
  return (
    <View style={gap ? styles.withGap : undefined}>
      <StatusPulse color={color} size={size} pulse={pulse} />
    </View>
  )
}

const styles = StyleSheet.create({
  withGap: {
    marginRight: 8
  }
})
