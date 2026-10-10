import type { NativeChatVisualTheme } from '../../../src/shared/native-chat-visual-shell'
import { radii } from '../theme/mobile-theme'
import type { ThemeColors, ThemeScheme } from '../theme/tokens'

/** Desktop's `--chart-1..5` (the Tailwind blue 300-800 ramp), as hex. Desktop uses the same ramp in
 *  light and dark (main.css `:root` and `.dark`), so the phone does too. */
const CHART_SERIES = ['#8ec5ff', '#2b7fff', '#155dfc', '#1447e6', '#193cb8'] as const

/**
 * The phone's live theme as the variables a visual styles against. Upstream (Orca #26071) pinned
 * the phone's one dark palette; this app has light and dark, so the document is built from the
 * scheme the reader is in and rebuilt when it changes (the frame reloads its visual).
 */
export function mobileNativeChatVisualTheme(
  colors: ThemeColors,
  scheme: ThemeScheme
): NativeChatVisualTheme {
  return {
    colorScheme: scheme,
    tokens: {
      '--background': colors.bg,
      '--foreground': colors.text,
      '--card': colors.bgPanel,
      '--card-foreground': colors.text,
      '--popover': colors.bgRaised,
      '--popover-foreground': colors.text,
      // Desktop's primary is the neutral ink on the page, inverted for its label.
      '--primary': colors.text,
      '--primary-foreground': colors.bg,
      '--secondary': colors.bgRaised,
      '--secondary-foreground': colors.text,
      '--muted': colors.bgRaised,
      '--muted-foreground': colors.textMuted,
      '--accent': colors.bgRaised,
      '--accent-foreground': colors.text,
      '--destructive': colors.danger,
      '--destructive-foreground': colors.onDanger,
      '--border': colors.border,
      '--input': colors.border,
      '--ring': colors.textMuted,
      '--radius': `${radii.row}px`,
      '--chart-1': CHART_SERIES[0],
      '--chart-2': CHART_SERIES[1],
      '--chart-3': CHART_SERIES[2],
      '--chart-4': CHART_SERIES[3],
      '--chart-5': CHART_SERIES[4],
      '--font-sans': '-apple-system, system-ui, Roboto, sans-serif',
      '--font-mono': 'Menlo, monospace'
    }
  }
}
