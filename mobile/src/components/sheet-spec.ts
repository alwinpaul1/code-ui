import type { ThemeColors } from '../theme/tokens'
import { DRAWER_SPRING } from './drawer-spring'
import { BOTTOM_DRAWER_HIDE_DURATION_MS } from './bottom-drawer-constants'

// One bottom sheet LOOK, after the Claude Android app (com.anthropic.claude
// 1.261009.20, decompiled 2026-10-14). Every sheet there goes through one
// wrapper (xhv.java:1514) around Material 3's ModalBottomSheet
// (ywi.java:1899), so every sheet has the same corners, ground, grabber and
// scrim. Code UI's sheets (BottomDrawer, DraggableDetailSheet, the queue
// editor) take those from this file, and sheet-spec.test.tsx keeps any sheet
// from drifting off it.
//
// MOTION IS A DELIBERATE DEVIATION. The app opens and settles its sheets on
// M3 springs (below, for reference). Code UI ported them on 2026-10-14 and the
// user rejected the result the same day ("Dont do this"; "We need it smooth
// same as we have in latest release"): a spring from rest showed nothing on
// the open's first frame. So every sheet moves exactly as in 0.9.139
// (237ce4dca): `SHEET_SPEC.motion` records those values, and the tests pin
// them.

/** A spring the way Compose states one: damping ratio and stiffness at unit mass. */
export type ComposeSpring = { dampingRatio: number; stiffness: number }

/** Material 3's standard motion scheme, as the Claude app ships it
 *  (syl.java:6-11). REFERENCE ONLY: Code UI's sheets do not use it (see above).
 *  The app shows and settles a sheet on DefaultSpatial and hides it on
 *  FastEffects (e230.java:74-91); its scrim fades on DefaultEffects
 *  (ywi.java:2168). */
export const M3_STANDARD_MOTION = {
  defaultSpatial: { dampingRatio: 0.9, stiffness: 700 },
  fastSpatial: { dampingRatio: 0.9, stiffness: 1400 },
  slowSpatial: { dampingRatio: 0.9, stiffness: 300 },
  defaultEffects: { dampingRatio: 1, stiffness: 1600 },
  fastEffects: { dampingRatio: 1, stiffness: 3800 },
  slowEffects: { dampingRatio: 1, stiffness: 800 }
} as const satisfies Record<string, ComposeSpring>

/** Which theme token stands for each of the app's sheet colours. The app's
 *  SheetColors (shv.java, built by oiv.c, oiv.java:24-39) are container
 *  `pl7.q`, content `pl7.O` and grabber `pl7.x`; the scrim is M3's default,
 *  the scheme's `scrim` (black, krz.java:4967) at 32% (ywi.java:2049). */
export const SHEET_COLOR_TOKENS = {
  /** pl7.q, the screen background: #F9F9F7 / #151515, exactly `chatBg`. */
  container: 'chatBg',
  /** pl7.O: #131313 / #F9F9F7; `text` is the nearest (#1E1C19 / #F8F8F6). */
  content: 'text',
  /** pl7.x, the hairline: #1E1E1D / #E1E0D9 at 15%, exactly `composerBorder`. */
  handle: 'composerBorder',
  /** Black at 32% in both schemes: `sheetScrim`. */
  scrim: 'sheetScrim'
} as const satisfies Record<string, keyof ThemeColors>

export type SheetColors = Record<keyof typeof SHEET_COLOR_TOKENS, string>

/** The sheet's colours in the active scheme. Read through `useTheme()`, so a
 *  sheet follows the user's appearance setting like everything else. */
export function sheetColors(colors: ThemeColors): SheetColors {
  return {
    container: colors[SHEET_COLOR_TOKENS.container],
    content: colors[SHEET_COLOR_TOKENS.content],
    handle: colors[SHEET_COLOR_TOKENS.handle],
    scrim: colors[SHEET_COLOR_TOKENS.scrim]
  }
}

export const SHEET_SPEC = {
  /** Top corners, oiv.b = mfs.d(44, 44, 0, 0) (oiv.java:9). */
  radius: 44,
  /** The grabber (wu20.java:928): padding oiv.h (6 / 5.5, oiv.java:15), then a
   *  36 × 5 bar (oiv.i, oiv.java:16) clipped to a circle shape. */
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    paddingHorizontal: 6,
    paddingVertical: 5.5
  },
  /** Code UI's sheet motion, unchanged from 0.9.139 (see the note at the top). */
  motion: {
    /** The open, and a refused close's return: a timing. BottomDrawer eases
     *  it out (cubic); the tool-detail sheet uses Reanimated's default curve.
     *  Under reduced motion BottomDrawer fades on the same timing and the
     *  tool-detail sheet appears at once. */
    openMs: 180,
    /** The hide (the backdrop, the Back key, the X, a parent's close). */
    hideMs: BOTTOM_DRAWER_HIDE_DURATION_MS,
    /** The settle after a drag: ratio 1 at a 0.31 s response (drawer-spring.ts). */
    settle: DRAWER_SPRING,
    /** The scrim has no motion of its own: its opacity follows the sheet's
     *  open progress (and fades as the sheet is dragged down). */
    scrimFollowsOpen: true
  }
} as const

/** The app draws the grabber only when the sheet has a partial stop: the
 *  dragHandle slot is filled only when `okv.e()` (anchors include
 *  PartiallyExpanded) is true (xhv.java:1469-1477). A sheet with one rest
 *  keeps the grabber's space and its drag, without the bar. */
export function sheetShowsHandle(hasPartialStop: boolean): boolean {
  return hasPartialStop
}
