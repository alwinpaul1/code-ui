import type { ThemeColors } from '../theme/tokens'
import type { AnimatedSpringConfig } from '../ui/alert/alert-motion'

// One bottom sheet, after the Claude Android app (com.anthropic.claude
// 1.261009.20, decompiled 2026-10-14). Every sheet there goes through one
// wrapper (xhv.java:1514) around Material 3's ModalBottomSheet
// (ywi.java:1899), so every sheet has the same corners, ground, grabber,
// scrim and motion. Code UI had two families that disagreed on all five
// (BottomDrawer: 24 dp corners in code over 16 dp in its stylesheet, 180 ms
// timed open; DraggableDetailSheet: 24 dp, its own 36×4 grabber). Both read
// this file now, and sheet-spec.test.tsx keeps any sheet from drifting off it.

/** A spring the way Compose states one: damping ratio and stiffness, at unit
 *  mass (`spring(dampingRatio, stiffness)`, hay.A in the decompile). Named
 *  mass on purpose: Reanimated 4 merges a config over a default whose mass is
 *  4 (spring-mass-census.test.ts). */
export type ComposeSpring = { dampingRatio: number; stiffness: number }

/** c = 2 · ζ · √(k · m) at m = 1, the conversion Compose's SpringSimulation uses. */
export function springFromComposeParams({ dampingRatio, stiffness }: ComposeSpring): AnimatedSpringConfig {
  if (!(stiffness > 0) || !(dampingRatio > 0)) {
    throw new Error(`spring needs a positive ratio and stiffness, got ${dampingRatio} / ${stiffness}`)
  }
  const mass = 1
  return { stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness * mass), mass }
}

/** Material 3's standard motion scheme, as the app ships it (syl.java:6-11). */
export const M3_STANDARD_MOTION = {
  /** syl.b: DefaultSpatial. The sheet's show, and its settle after a drag (e230.java:74-91). */
  defaultSpatial: { dampingRatio: 0.9, stiffness: 700 },
  /** syl.c: FastSpatial. */
  fastSpatial: { dampingRatio: 0.9, stiffness: 1400 },
  /** syl.d: SlowSpatial. */
  slowSpatial: { dampingRatio: 0.9, stiffness: 300 },
  /** syl.e: DefaultEffects. The scrim's alpha, "ScrimAlphaAnimation" (ywi.java:2168). */
  defaultEffects: { dampingRatio: 1, stiffness: 1600 },
  /** syl.f: FastEffects. The sheet's hide (e230.java:78). */
  fastEffects: { dampingRatio: 1, stiffness: 3800 },
  /** syl.g: SlowEffects. */
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
  motion: {
    /** The sheet's show (and a refused close's return). */
    open: springFromComposeParams(M3_STANDARD_MOTION.defaultSpatial),
    /** The sheet coming to rest after a drag (anchoredDraggable, same spring). */
    settle: springFromComposeParams(M3_STANDARD_MOTION.defaultSpatial),
    /** The scrim's fade in and out, a spring of its own (ywi.java:2168). */
    scrim: springFromComposeParams(M3_STANDARD_MOTION.defaultEffects),
    /** Reduced motion: the sheet does not travel; it fades on the effects spring. */
    reducedOpen: springFromComposeParams(M3_STANDARD_MOTION.defaultEffects),
    /** The hide, as a timing: FastEffects (ζ 1, k 3800) is critically damped
     *  and is within 0.1% of rest at 150 ms, and the close lifecycle hangs off
     *  this animation's completion callback, which every close test plays. */
    hideMs: 150
  }
} as const

/** The app draws the grabber only when the sheet has a partial stop: the
 *  dragHandle slot is filled only when `okv.e()` (anchors include
 *  PartiallyExpanded) is true (xhv.java:1469-1477). A sheet with one rest
 *  keeps the grabber's space and its drag, without the bar. */
export function sheetShowsHandle(hasPartialStop: boolean): boolean {
  return hasPartialStop
}
