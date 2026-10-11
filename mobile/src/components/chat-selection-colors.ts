import type { ThemeColors } from '../theme/tokens'

/** The Claude app's selection highlight is its primary at this alpha (TextSelectionColors `k4y`,
 *  built in its theme `bek.a` as `primary.copy(alpha = 0.4f)`). */
export const CHAT_SELECTION_HIGHLIGHT_ALPHA = 0.4

export type ChatSelectionColors = {
  /** The selection handles. */
  handle: string
  /** Behind the selected words, or null to leave the platform's: an accent this cannot read is
   *  never drawn opaque over the words it selects. */
  highlight: string | null
}

/**
 * A chat reply's selection colours, from the theme's accent in whichever scheme the app shows: the
 * handles in the accent and the highlight the accent at 40%, as the Claude app does with its
 * primary. modules/orca-selection-copy puts them on every Text of the document
 * (ChatSelectionColors.kt).
 */
export function chatSelectionColors(colors: Pick<ThemeColors, 'accent'>): ChatSelectionColors {
  return { handle: colors.accent, highlight: withAlpha(colors.accent, CHAT_SELECTION_HIGHLIGHT_ALPHA) }
}

/** `#rgb` or `#rrggbb` at `alpha`, as rgba(); null for anything else (a colour with its own alpha
 *  included), which the caller leaves to the platform. */
function withAlpha(color: string, alpha: number): string | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  const parts = short ? short.slice(1).map((digit) => digit + digit) : long ? long.slice(1) : null
  if (!parts) {
    return null
  }
  const [r, g, b] = parts.map((part) => Number.parseInt(part, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
