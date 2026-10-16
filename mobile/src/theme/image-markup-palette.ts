import type { ThemeScheme } from './tokens'

/**
 * The colours of the Claude app's image markup screen, per scheme. Read from com.anthropic.claude
 * 1.261013.20 (jadx, 2026-10-16; `brh`, `xqh`, `zqh`, `vqh` in classes3.dex, the theme table
 * `ym7` built in k79.java:75/157 from `zxy` light and `yxy` dark):
 *
 * - `canvas`: `g79.b`, black in both schemes (xqh.java:84). The photo is drawn on it;
 * - `pill`: `ym7.q` through `j7w.d` (j7w.java:32), `z79.e` #F9F9F7 light and `z79.x` #151515
 *   dark. The round Close and Done buttons and the undo/redo pill (vqh.java:63, zqh.java:149);
 * - `glyph`: `ym7.O` through `j7w.e`, #131313 light and #F9F9F7 dark. Close, undo and redo;
 * - `glyphDisabled`: Material 3's disabled content, that ink at 38% (`ofy.r`'s default);
 * - `divider`: `ym7.x`, `z79.v` #1E1E1D light and `z79.i` #E1E0D9 dark, each at 15%. The 1 x 20 dp
 *   line between undo and redo (vqh.java:106);
 * - `done`: `ym7.e`, the clay #C6613F light and #D97757 dark. Done's check (zqh.java:149);
 * - `canvasText`: `g79.d`, white. The spinner and "Preview unavailable" on the black canvas
 *   (brh.java:284).
 *
 * A module of its own for the reason the session pill palette is: `tokens.ts` is shared by every
 * screen and sits at its line ceiling. The editor reads `imageMarkupPalette(useTheme().scheme)`,
 * so the bar cannot draw one scheme on the other's screen.
 */
export type ImageMarkupPalette = {
  canvas: string
  pill: string
  glyph: string
  glyphDisabled: string
  divider: string
  done: string
  canvasText: string
}

const light: ImageMarkupPalette = {
  canvas: '#000000',
  pill: '#F9F9F7',
  glyph: '#131313',
  glyphDisabled: 'rgba(19, 19, 19, 0.38)',
  divider: 'rgba(30, 30, 29, 0.15)',
  done: '#C6613F',
  canvasText: '#FFFFFF'
}

const dark: ImageMarkupPalette = {
  canvas: '#000000',
  pill: '#151515',
  glyph: '#F9F9F7',
  glyphDisabled: 'rgba(249, 249, 247, 0.38)',
  divider: 'rgba(225, 224, 217, 0.15)',
  done: '#D97757',
  canvasText: '#FFFFFF'
}

export function imageMarkupPalette(scheme: ThemeScheme): ImageMarkupPalette {
  return scheme === 'dark' ? dark : light
}
