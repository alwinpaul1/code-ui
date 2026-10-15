import type { ThemeScheme } from './tokens'

/**
 * The colours of the Claude app's session pills (Diff, pull request, CI dot) and of its +N / -M
 * line counts, per scheme. Read from com.anthropic.claude 1.261009.20 (jadx, 2026-10-15); each
 * value names the theme token (`pl7` field or `ad5` method, resolved light/dark from
 * `c59.e`/`c59.f` and `j95`/`i65`) and the class that reads it:
 *
 * - counts "+N" / "-M" of the Diff pill and of file rows: `ad5.K()` and `ad5.u()`
 *   (`jlc.b`, jlc.java:292 and :306);
 * - the +A -R chip of tool rows and file rows: `ra20.a` (ra20.java:92-93): text `ad5.J()` on
 *   `ad5.f0()` and `ad5.h()` on `ad5.s()`; the fills are ARGB ints 0x33 over the text colour (20%);
 * - every pill is `jc20.c` (jc20.java:538): fill `pl7.p`, hairline `pl7.v`; the pull request pill
 *   (`jc20.q`, jc20.java:7446) swaps in a `zko` per state: draft/open/closed keep the surface and
 *   take `ad5.y()` for the number and CI label, merged is fill `ad5.i0()`, border `ad5.a0()`,
 *   text `ad5.T()`, queued is `ad5.W()`, `ad5.c()`, `ad5.m()`; the state icon is `w130.o`
 *   (w130.java:2443): `ad5.y()` draft, `ad5.K()` open, `ad5.u()` closed, `ad5.T()` merged,
 *   `ad5.m()` queued;
 * - the CI dot (`jc20.l`, jc20.java:7069): `ad5.e0()` passed, `ad5.G()` failed, `ad5.y()` status
 *   unavailable; pending is a spinner in the pill's own text colour.
 *
 * Why a module of its own and not `tokens.ts`: that file is shared by every screen and moves one
 * batch at a time (the same reason as `mobile-diff-claude-palette.ts`). A component reads
 * `claudeSessionPillPalette(useTheme().scheme)`, so a pill cannot draw one scheme on the other's page.
 */
export type ClaudeSessionPillPalette = {
  countAddText: string
  countDelText: string
  chipAddText: string
  chipAddFill: string
  chipDelText: string
  chipDelFill: string
  /** `pl7.p`. */
  surface: string
  /** `pl7.v`. */
  border: string
  /** `ad5.y()`: the number and CI label of a draft, open or closed pull request. */
  pillText: string
  prOpen: string
  prDraft: string
  prClosed: string
  mergedFill: string
  mergedBorder: string
  mergedText: string
  queuedFill: string
  queuedBorder: string
  queuedText: string
  ciPassed: string
  ciFailed: string
  ciUnavailable: string
}

const light: ClaudeSessionPillPalette = {
  countAddText: '#006300',
  countDelText: '#8E2626',
  chipAddText: '#1E9E3C',
  chipAddFill: 'rgba(30, 158, 60, 0.2)',
  chipDelText: '#CD2054',
  chipDelFill: 'rgba(205, 32, 84, 0.2)',
  surface: '#FFFFFF',
  border: 'rgba(30, 30, 29, 0.4)',
  pillText: '#898781',
  prOpen: '#006300',
  prDraft: '#898781',
  prClosed: '#8E2626',
  mergedFill: '#DFDBFD',
  mergedBorder: '#B0A7F2',
  mergedText: '#4A3AA7',
  queuedFill: '#F9DCA4',
  queuedBorder: '#EDA100',
  queuedText: '#734500',
  ciPassed: '#009300',
  ciFailed: '#D03B3B',
  ciUnavailable: '#898781'
}

const dark: ClaudeSessionPillPalette = {
  countAddText: '#0CA30C',
  countDelText: '#EC7E7E',
  chipAddText: '#32D74B',
  chipAddFill: 'rgba(50, 215, 75, 0.2)',
  chipDelText: '#FF2C56',
  chipDelFill: 'rgba(255, 44, 86, 0.2)',
  surface: '#20201F',
  border: 'rgba(225, 224, 217, 0.4)',
  pillText: '#898781',
  prOpen: '#0CA30C',
  prDraft: '#898781',
  prClosed: '#EC7E7E',
  mergedFill: '#1D1649',
  mergedBorder: '#322777',
  mergedText: '#A096EB',
  queuedFill: '#311A00',
  queuedBorder: '#512E00',
  queuedText: '#DB9300',
  ciPassed: '#009300',
  ciFailed: '#D03B3B',
  ciUnavailable: '#898781'
}

export function claudeSessionPillPalette(scheme: ThemeScheme): ClaudeSessionPillPalette {
  return scheme === 'dark' ? dark : light
}
