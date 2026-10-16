import type { ThemeScheme } from './tokens'

/**
 * The colours of the Claude app's model and Effort sheets, per scheme (com.anthropic.claude
 * 1.261013.20, jadx, read 2026-10-16):
 *
 * - `check`: the selected row's check, `C0()` (w8m.java:1209, er1 case 4), #184F95 / #6DA7EC;
 * - `badgeNeutral*`: a row pill's neutral variant ("Recommended"), w8m.a (w8m.java:11-46): ink or
 *   white at 5% behind #52514E / #C3C2B7;
 * - `badgeWarning*`: its warning variant ("4× or more usage"): amber at 10% behind the same amber;
 * - `caption`: the line under the Effort list, `x0()` (w8m.e), #52514E / #C3C2B7.
 */
export type ClaudePickerPalette = {
  check: string
  badgeNeutralFill: string
  badgeNeutralText: string
  badgeWarningFill: string
  badgeWarningText: string
  caption: string
}

const light: ClaudePickerPalette = {
  check: '#184F95',
  badgeNeutralFill: 'rgba(11, 11, 11, 0.05)',
  badgeNeutralText: '#52514E',
  badgeWarningFill: 'rgba(166, 106, 0, 0.1)',
  badgeWarningText: '#A66A00',
  caption: '#52514E'
}

const dark: ClaudePickerPalette = {
  check: '#6DA7EC',
  badgeNeutralFill: 'rgba(255, 255, 255, 0.05)',
  badgeNeutralText: '#C3C2B7',
  badgeWarningFill: 'rgba(183, 119, 0, 0.1)',
  badgeWarningText: '#B77700',
  caption: '#C3C2B7'
}

export function claudePickerPalette(scheme: ThemeScheme): ClaudePickerPalette {
  return scheme === 'dark' ? dark : light
}
