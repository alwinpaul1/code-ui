// The Claude Android app's motion numbers for the transcript and its cards
// (com.anthropic.claude 1.261009.20, decompiled with jadx 2026-10-14, read
// only). Where each number comes from, so the next release can be re-checked:
//
//   easing          k8d.java:7       `k8d.a` = cubic-bezier(0.4, 0, 0.2, 1), the
//                                    default of `hay.E(duration, delay, easing,
//                                    mask)` (hay.java:102-113): every tween
//                                    below that names no easing uses it
//   agent pulse     cu2.java:1071    `p54.B(infinite, 1.0f, 0.55f,
//                   (also 1234,      infiniteRepeatable(tween(1200, k8d.a),
//                   1575)            RepeatMode 2 = Reverse, offset i * -240),
//                                    "agent-pulse-" + i)` for i in 0..4: FIVE
//                                    pulses, shared by every agent cell
//                                    (`pulses[floorMod(agentId, 5)]`, cu2.java:2144)
//   dot and cells   cu2.java:2609    the workflow status dot is 8 dp, round, and
//                   cu2.java:1798    pulses with pulse 0 while running; a cell
//                   cu2.java:19      of the agent grid is an 8 dp square, 2 dp
//                                    corner, 3 dp apart (`cu2.b`, `cu2.d`,
//                                    `cu2.c`), a running one `pl7.m` pulsing
//   todo pill       yfy.java:3873    "beside the to-do pill": alpha 1 <- 0 on a
//                                    tween(150), snap (`k4w`) when it goes
//   turn edits      bv20.java:2259   the card's rows enter on `expandVertically`
//                   nmd.java:591,615 (`nmd.f`, tween 250) plus `fadeIn` (`nmd.g`,
//                                    tween 250); the exit is None (`dee.b`)
//   copy glyph      fa20.java:266    copy -> check, its colour tweened to
//                                    `ad5.K()` over `hay.E(300)`; the check
//                                    holds 2000 ms before the glyph goes back
//                                    (code-block-spec.ts, l82.java)
//   stream          c0x.java:12-60   the smoothing config's defaults (below)
//
// The pulse offset is written `i * -240`, a negative packed `StartOffset`. In
// Compose a negative packed offset is `StartOffsetType.FastForward` (a positive
// one is `Delay`): cell i starts 240 * i ms into its own timeline, so the five
// run a fifth of a cycle apart (read from the Compose encoding, not from a
// string in the app: inferred).
//
// A Reverse repeat plays the same tween back: 1.0 down to 0.55 over 1200 ms,
// then 0.55 up to 1.0 over 1200 ms, on the easing both ways. One cycle is
// 2400 ms.

/** `k8d.a`: Material's "standard" curve, FastOutSlowIn. */
export const CLAUDE_EASE = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const

export const AGENT_PULSE = {
  /** Alpha at rest and at the top of the pulse. */
  fromAlpha: 1,
  /** Alpha at the bottom. */
  toAlpha: 0.55,
  /** One leg (down or up). A cycle is two. */
  legMs: 1200,
  /** How many pulses the agents share. */
  phases: 5,
  /** Each phase runs this far ahead of the one before it (`i * -240`, a fast-forward). */
  fastForwardMs: 240
} as const

/** The todo pill's neighbour fades in over this long; it vanishes at once. */
export const TODO_PILL_FADE_MS = 150

/** The turn edits card's extra rows grow and fade in over this long; they leave at once. */
export const TURN_EDITS_EXPAND_MS = 250

/** The Copy glyph's colour moves to the copied tint over this long. */
export const COPY_ICON_TINT_MS = 300

/** How long the check stays before the Copy glyph returns. */
export const COPY_CHECK_HOLD_MS = 2_000

/**
 * `StreamSmoothingConfig` (c0x.java), the app's defaults. NOT applied in Code
 * UI: the structured lane re-parses a growing reply's Markdown on every
 * change, and a 33 ms tick would do that thirty times a second on the phone's
 * main thread with no way to measure the frame cost here (the same cost
 * mobile-markdown-streaming-cost.test.ts guards). The numbers are kept so a
 * later pass that can measure on the device does not have to read the app again.
 * The app gates it behind the remote flag `android_chat_stream_smoothing`
 * (rs8.java:746), fade-in off (`fade_in_tail_chars` 0).
 */
export const STREAM_SMOOTHING = {
  smootherTickIntervalMs: 33,
  minMarkdownGroupSizeChars: 800,
  fadeInTailChars: 0,
  /** `VoiceClient.MAX_REORDER_WAIT_MS`, reused as a plain 200. */
  fadeInDurationMs: 200,
  catchUpLagMs: 250,
  catchUpMinCharsPerSecond: 80,
  catchUpMaxCharsPerSecond: 600,
  catchUpRateEasingMs: 250,
  revealWithinMs: 450
} as const

/** One full pulse: down and back up. */
export const AGENT_PULSE_PERIOD_MS = AGENT_PULSE.legMs * 2

/**
 * `cubic-bezier(0.4, 0, 0.2, 1)` at `x` in [0, 1]: the progress of a tween
 * that has run `x` of its duration. A worklet, so a Reanimated mapper and a
 * tween's `easing` can both call it on the UI thread.
 */
export function claudeEase(x: number): number {
  'worklet'
  if (x <= 0) {
    return 0
  }
  if (x >= 1) {
    return 1
  }
  const { x1, y1, x2, y2 } = CLAUDE_EASE
  const at = (a: number, b: number, t: number): number => {
    const u = 1 - t
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
  }
  // Solve x(t) = x by bisection: 30 halvings is far below a pixel's worth of
  // alpha, and it cannot diverge the way Newton's step can on a flat stretch.
  let low = 0
  let high = 1
  for (let step = 0; step < 30; step += 1) {
    const mid = (low + high) / 2
    if (at(x1, x2, mid) < x) {
      low = mid
    } else {
      high = mid
    }
  }
  return at(y1, y2, (low + high) / 2)
}

/**
 * The alpha of pulse `phase` (0 to 4; any integer, folded into that range as
 * the app's `floorMod(id, 5)` does) `elapsedMs` after the pulses started.
 */
export function agentPulseAlpha(elapsedMs: number, phase: number): number {
  'worklet'
  const { fromAlpha, toAlpha, legMs, phases, fastForwardMs } = AGENT_PULSE
  const cell = ((Math.floor(phase) % phases) + phases) % phases
  const period = legMs * 2
  const at = (((elapsedMs + fastForwardMs * cell) % period) + period) % period
  // Down on the way out, the same curve back up on the return: Reverse mode.
  const along = at < legMs ? at / legMs : 2 - at / legMs
  return fromAlpha + (toAlpha - fromAlpha) * claudeEase(along)
}
