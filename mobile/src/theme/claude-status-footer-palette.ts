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
 *   ("· still thinking…", nl7.java:213-224); claude-working-footer-stats.ts. Also the live tool
 *   row's chevron (`fp30.c`'s default tint, fp30.java:112);
 * - `toolLabel`: `ad5.x0()`, #52514E light and #C3C2B7 dark. The live tool row's label ("Running
 *   ls", wm7.java:250), 1.261013.20: `ad5` is `g95` light (`w55.z0` = `z79.q`
 *   0xFF52514E) and `e65` dark (`v55.z0` = `z79.j` 0xFFC3C2B7), e65.java/g95.java:603-605;
 * - `toolClock`: `ad5.y()`, #898781 in both. The live tool row's elapsed time (wm7.java:264),
 *   `w55.w0` / `v55.w0` = `z79.m` 0xFF898781, e65.java/g95.java:608-610 (claude-live-tool-row.ts).
 *
 * A module of its own for the reason the session pill palette is: `tokens.ts` is shared by every
 * screen. A component reads `claudeStatusFooterPalette(useTheme().scheme)`, so the line cannot
 * draw one scheme on the other's page.
 */
export type ClaudeStatusFooterPalette = {
  clay: string
  link: string
  body: string
  toolLabel: string
  toolClock: string
}

const light: ClaudeStatusFooterPalette = {
  clay: '#C6613F',
  link: '#184F95',
  body: '#7B7974',
  toolLabel: '#52514E',
  toolClock: '#898781'
}
const dark: ClaudeStatusFooterPalette = {
  clay: '#D97757',
  link: '#6DA7EC',
  body: '#97958D',
  toolLabel: '#C3C2B7',
  toolClock: '#898781'
}

export function claudeStatusFooterPalette(scheme: ThemeScheme): ClaudeStatusFooterPalette {
  return scheme === 'dark' ? dark : light
}
