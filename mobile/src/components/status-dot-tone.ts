import { colors as legacyColors } from '../theme/mobile-theme'
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

/** Legacy hex resolver kept for callers that compare against the static
 *  palette. Themed code should use `useStatusColor` from StatusDot instead. */
export function statusDotColor(state: ConnectionState, verdict?: ConnectionVerdict): string {
  const tone = statusTone(state, verdict)
  switch (tone) {
    case 'success':
      return legacyColors.statusGreen
    case 'warning':
      return legacyColors.statusAmber
    case 'danger':
      return legacyColors.statusRed
    case 'muted':
      return legacyColors.textMuted
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}
