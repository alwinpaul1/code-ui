import type { ThemeScheme } from './tokens'

/**
 * The colours of the Claude app's working footer (the line above its composer), per scheme. Read
 * from com.anthropic.claude 1.261009.20 (jadx, 2026-10-15; theme tables in docs/claude-app-typography.md):
 *
 * - `clay`: `pl7.e`, #C6613F light and #D97757 dark. The spinner's tint (nl7.java:61), the verb
 *   ("Cooking...", nl7.java:377) and the " · " before the count (nl7.java:293);
 * - `link`: `ad5.C0()` (nl7.java:263 idle, :290 inside the working line), #184F95 light and
 *   #6DA7EC dark. The "N running tasks" text, idle or working;
 * - `body`: `pl7.Q`, #7B7974 light and #97958D dark. The stats the app draws before the count
 *   ("15s", nl7.java:196), the " · " before the count beside them, and the status phrase after it
 *   ("· still thinking…", nl7.java:213-224); claude-working-footer-stats.ts.
 *
 * A module of its own for the reason the session pill palette is: `tokens.ts` is shared by every
 * screen. A component reads `claudeStatusFooterPalette(useTheme().scheme)`, so the line cannot
 * draw one scheme on the other's page.
 */
export type ClaudeStatusFooterPalette = {
  clay: string
  link: string
  body: string
}

const light: ClaudeStatusFooterPalette = { clay: '#C6613F', link: '#184F95', body: '#7B7974' }
const dark: ClaudeStatusFooterPalette = { clay: '#D97757', link: '#6DA7EC', body: '#97958D' }

export function claudeStatusFooterPalette(scheme: ThemeScheme): ClaudeStatusFooterPalette {
  return scheme === 'dark' ? dark : light
}
