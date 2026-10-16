import type { ThemeScheme } from './tokens'

/**
 * The violet of the Claude app's Artifact card (1.261013.20; the card is kv30.a → bs30.d, its
 * colours the theme's violet tint, k79.java:75 light and :147 dark), per scheme:
 *
 * - `cardFill`: the card's ground, the tint's lightest step over whatever surface the card sits on
 *   (#FCFBFF at 10% in light, #1D1649 at 15% in dark). Written as rgba so it stays OVER the surface
 *   the theme draws beneath it, never a surface of its own that ignores the scheme;
 * - `tileFill` / `tileBorder`: the page tile peeking out of the card's bottom edge;
 * - `icon`: the artifacts glyph on the tile (CdsIcon.artifacts, U+E017).
 *
 * The card's own border is the theme's `border` token and its words the theme's ink, read from
 * useTheme() beside this. A module of its own for the same reason as claude-tool-run-palette.ts:
 * tokens.ts is shared by every screen and sits at its line cap.
 */
export type ClaudeArtifactCardPalette = {
  cardFill: string
  tileFill: string
  tileBorder: string
  icon: string
}

const LIGHT: ClaudeArtifactCardPalette = {
  cardFill: 'rgba(252, 251, 255, 0.1)',
  tileFill: '#EFEDFF',
  tileBorder: '#BFB9F5',
  icon: '#4A3AA7'
}

const DARK: ClaudeArtifactCardPalette = {
  cardFill: 'rgba(29, 22, 73, 0.15)',
  tileFill: '#1D1649',
  tileBorder: '#322777',
  icon: '#A096EB'
}

export function claudeArtifactCardPalette(scheme: ThemeScheme): ClaudeArtifactCardPalette {
  return scheme === 'dark' ? DARK : LIGHT
}
