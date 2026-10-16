import type { ThemeScheme } from './tokens'

/**
 * The colours of the Claude app's collapsed step rows in a transcript ("Ran 2 commands ›",
 * "Running ›", "Running agent: … ›", "Thought process ›"), per scheme. Read from
 * com.anthropic.claude 1.261013.20 (jadx, 2026-10-16); session/claude-tool-run-row-spec.ts has the
 * lines:
 *
 * - `text`: the words, the chevron (`fp30.c`) and the thought row's glyph, `ym7.Q`
 *   (onSurfaceVariant);
 * - `icon`: a running row's leading icon (an agent's diamond, a background task), `ad5.y()`
 *   (ci4.java:30, the slot `i430.c` fills), the same grey in both schemes.
 *
 * Why a module of its own and not `tokens.ts`: that file is shared by every screen and sits at its
 * line cap (the same reason as `claude-session-pill-palette.ts`). A component reads
 * `claudeToolRunPalette(useTheme().scheme)`, so a row cannot draw one scheme on the other's page.
 */
export type ClaudeToolRunPalette = {
  text: string
  icon: string
}

const LIGHT: ClaudeToolRunPalette = { text: '#7B7974', icon: '#898781' }
const DARK: ClaudeToolRunPalette = { text: '#97958D', icon: '#898781' }

export function claudeToolRunPalette(scheme: ThemeScheme): ClaudeToolRunPalette {
  return scheme === 'dark' ? DARK : LIGHT
}
