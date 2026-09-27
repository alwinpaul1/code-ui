import { darkColors, type ThemeColors } from '../../theme/tokens'
import type { MobileStatusToken } from './pr-checks-presentation'

// Resolves a pure-logic status token to a concrete themed color. Keeps the
// presentation module free of style imports while centralizing the mapping.
//
// `colors` defaults to `darkColors`: callers outside the PR sidebar slice (the
// workspace-list linked-PR badge, the source-control chips, the chat task list)
// still call this with one argument and, until their own theme pass, keep the
// exact colors they always drew (this default reproduces the old dark-only
// static palette byte for byte). Every call inside the PR sidebar passes the
// live `useTheme().colors` explicitly.
export function statusColor(token: MobileStatusToken, colors: ThemeColors = darkColors): string {
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
