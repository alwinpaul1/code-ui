import type { ThemeColors } from '../../theme/tokens'
import type { MobileStatusToken } from './pr-checks-presentation'

// Resolves a pure-logic status token to a concrete themed color. Keeps the
// presentation module free of style imports while centralizing the mapping.
//
// `colors` is required: every caller passes the live `useTheme().colors`. It
// used to default to `darkColors`, and the two callers that relied on the
// default (the workspace row's PR badge and the branch card's PR chip) drew
// the dark scheme's colours in a light session.
export function statusColor(token: MobileStatusToken, colors: ThemeColors): string {
  switch (token) {
    case 'statusGreen':
      return colors.success
    case 'statusAmber':
      return colors.warning
    case 'statusRed':
      return colors.danger
    case 'statusPurple':
      return colors.mergedPurple
    default:
      return colors.textSecondary
  }
}
