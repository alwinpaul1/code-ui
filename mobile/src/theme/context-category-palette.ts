import type { ContextColorSlot } from '../session/context-card-model'
import type { ThemeScheme } from './tokens'

/**
 * The colours of the context card's bar and legend, one per slot (context-card-model.ts), in both
 * schemes. They are the Claude app's own (com.anthropic.claude 1.261009.20): `l800.g` maps a slot to
 * an `ad5` accent, and the values are `ad5`'s light and dark resolutions (the decompile's
 * `plan/tokens_pl7.md`, 2026-10-14). Read through `useTheme().scheme`, like `syntax-palette.ts`: a
 * literal colour in the sheet would ignore the reader's appearance setting.
 *
 *   slot 1 `ad5.r()`   blue    #2A78D6 / #3987E5
 *   slot 2 `ad5.M()`   orange  #EB6834 / #D95926
 *   slot 3 `ad5.n()`   green   #1BAF7A / #199E70
 *   slot 4 `ad5.D0()`  amber   #EDA100 / #C98500
 *   slot 5 `ad5.r0()`  pink    #E87BA4 / #D55181
 *   slot 6 `ad5.C()`   green   #008300 / #008300
 *   slot 7 `ad5.d0()`  grey    #898781 / #97958D   everything past the named ones
 *   slot 8 `ad5.R()`   pale    #C3C2B7 / #5F5E5A   the autocompact buffer and deferred rows
 *   slot 9 `ad5.F()`   the bar's track: #898781 / #97958D at 15%
 */
export type ContextCategoryPalette = Record<ContextColorSlot, string>

export const lightContextCategoryPalette: ContextCategoryPalette = {
  1: '#2A78D6',
  2: '#EB6834',
  3: '#1BAF7A',
  4: '#EDA100',
  5: '#E87BA4',
  6: '#008300',
  7: '#898781',
  8: '#C3C2B7',
  9: 'rgba(137, 135, 129, 0.15)'
}

export const darkContextCategoryPalette: ContextCategoryPalette = {
  1: '#3987E5',
  2: '#D95926',
  3: '#199E70',
  4: '#C98500',
  5: '#D55181',
  6: '#008300',
  7: '#97958D',
  8: '#5F5E5A',
  9: 'rgba(151, 149, 141, 0.15)'
}

export function contextCategoryPaletteForScheme(scheme: ThemeScheme): ContextCategoryPalette {
  return scheme === 'dark' ? darkContextCategoryPalette : lightContextCategoryPalette
}
