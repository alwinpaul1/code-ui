import type { ThemeColors } from '../theme/tokens'
import { CLAWD_DANCING_FRAMES, CLAWD_DANCING_POSES } from './claude-clawd-dancing-frames'

/**
 * How the Claude Android app (com.anthropic.claude 1.261009.20) shows a Code session's
 * transcript loading. The lines named are in the decompiled app; the full trace is in
 * docs/claude-app-implementation-notes.md section 10.
 *
 * - The list's `loading` item (`yv8.java:8695`) draws `mu20.d`, filling the list's height:
 *   Clawd dancing (`oq7.b(nr7.Dancing, …, width 180 dp)`), 12 dp, then "Loading session…"
 *   (`ccr_loading_session`), centred, 16 dp side padding, `jn7.H` in `pl7.O`.
 * - Clawd is 40 frames on a 55 x 37 grid; the canvas shows the bottom 17 rows (`oq7.a`) at an
 *   aspect ratio of 55:17 (`dz20.a`), so it is 180 dp wide and 55.6 dp tall.
 * - The loop (`hr7`, "Loop(from=0.1, to=0.9)") plays frames 4 to 35 at 12 frames a second
 *   (`zx20.u` "rememberLoopingCel", `n1k`: a delay of round(1000 / 12) = 83 ms a frame).
 * - With animators off (`ValueAnimator.areAnimatorsEnabled()` false, `mu20.d`) it is "Still"
 *   (`kr7`), which holds frame 0 (`hl` case 13 sets the frame to 0).
 * - Older history is NOT this: the `history_spinner` item (`yv8.t`) is a plain 20 dp spinner.
 */
export const CLAUDE_TRANSCRIPT_LOADING = {
  /** `ccr_loading_session`, the copy for a Code session (`q09.Code`). */
  label: 'Loading session…',
  /** Clawd's width (`ixv.u(…, 180f)`). */
  width: 180,
  columns: 55,
  /** The rows the app's canvas shows (`oq7.a`). */
  rows: 17,
  /** Between Clawd and the label (`lb1(12f, …)`, Arrangement.spacedBy). */
  gap: 12,
  /** The label's side padding (`rrb.Q(…, 16f)`). */
  labelPaddingHorizontal: 16,
  framesPerSecond: 12,
  /** round(1000 / 12), as `n1k` computes the delay. */
  frameMs: 83,
  /** The loop's first frame and the frame after its last: floor(0.1 x 40) and floor(0.9 x 40). */
  loopFrom: 4,
  loopTo: 36,
  /** The frame "Still" shows. */
  stillFrame: 0
} as const

/** The frame that follows `frame` in the app's loop. */
export function nextClawdFrame(frame: number): number {
  const { loopFrom, loopTo } = CLAUDE_TRANSCRIPT_LOADING
  if (frame < loopFrom || frame >= loopTo - 1) {
    return loopFrom
  }
  return frame + 1
}

/** The app's palette letters (`gq7`) to the `clawd` theme tokens that hold their colours. */
const CELL_TOKENS = { o: 'body', d: 'shade', K: 'ink' } as const
type CellLetter = keyof typeof CELL_TOKENS

/** One path per colour: every run of same-coloured cells in a row becomes a 1-cell-tall
 *  rectangle of one path, so neighbouring cells share no anti-aliased seam. */
export type ClawdLayer = { token: (typeof CELL_TOKENS)[CellLetter]; d: string }

const layersByPose = new Map<number, readonly ClawdLayer[]>()

export function clawdLayers(frame: number): readonly ClawdLayer[] {
  const pose = CLAWD_DANCING_FRAMES[frame] ?? CLAWD_DANCING_FRAMES[CLAUDE_TRANSCRIPT_LOADING.stillFrame]!
  const cached = layersByPose.get(pose)
  if (cached) {
    return cached
  }
  const parts: Record<CellLetter, string[]> = { o: [], d: [], K: [] }
  CLAWD_DANCING_POSES[pose]!.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const cell = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === cell) {
        end++
      }
      if (cell in CELL_TOKENS) {
        parts[cell as CellLetter].push(`M${x} ${y}h${end - x}v1h${x - end}z`)
      }
      x = end
    }
  })
  const layers = (Object.keys(CELL_TOKENS) as CellLetter[])
    .filter((cell) => parts[cell].length > 0)
    .map((cell) => ({ token: CELL_TOKENS[cell], d: parts[cell].join('') }))
  layersByPose.set(pose, layers)
  return layers
}

/** The colour of each of Clawd's layers in a scheme. */
export function clawdLayerColor(colors: ThemeColors, layer: ClawdLayer): string {
  return colors.clawd[layer.token]
}
