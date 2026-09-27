import type { ThemeColors } from '../theme/tokens'
import type { ConnectionState } from '../transport/types'
import type { ConnectionVerdict } from '../transport/connection-health'

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted'

export const CONNECTION_STATE_TONES: Record<ConnectionState, StatusTone> = {
  connected: 'success',
  connecting: 'warning',
  handshaking: 'warning',
  reconnecting: 'warning',
  disconnected: 'muted',
  'auth-failed': 'danger'
}

// Why: when caller passes a verdict, the dot color reflects the verdict's
// severity instead of the raw transport state. This avoids the "amber dot
// next to red 'Can't reach desktop' label" mismatch — the underlying
// transport is still 'reconnecting' (amber) but the user-visible meaning
// has escalated to error (red).
export function statusTone(state: ConnectionState, verdict?: ConnectionVerdict): StatusTone {
  if (verdict?.kind === 'unreachable' || verdict?.kind === 'auth-failed') {
    return 'danger'
  }
  if (verdict?.kind === 'warning' || (verdict?.kind === 'normal' && verdict.label.endsWith('…'))) {
    return 'warning'
  }
  return CONNECTION_STATE_TONES[state] ?? 'muted'
}

/** Hex resolver for callers that need a colour outside a component (so they can't call
 *  `useStatusColor` from StatusDot themselves). Takes the live theme's colours rather than
 *  importing the legacy static palette, per the theme-settings sweep. */
export function statusDotColor(
  colors: ThemeColors,
  state: ConnectionState,
  verdict?: ConnectionVerdict
): string {
  const tone = statusTone(state, verdict)
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
