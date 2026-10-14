import { describe, expect, it } from 'vitest'
import { CODE_BLOCK_SPEC } from '../components/code-block-spec'
import {
  AGENT_PULSE,
  AGENT_PULSE_PERIOD_MS,
  CLAUDE_EASE,
  COPY_CHECK_HOLD_MS,
  COPY_ICON_TINT_MS,
  STREAM_SMOOTHING,
  QUEUED_MESSAGES_EXPAND_MS,
  SCROLL_BUTTON_BESIDE_PILL_FADE_MS,
  agentPulseAlpha,
  claudeEase
} from './claude-motion-spec'

// The numbers are the Claude Android app's (1.261009.20): cu2.java:1071 for the
// agent pulse (the offset's meaning in uts.java:22-30), yfy.java:3873 for the
// scroll button beside the to-do pill, bv20.java:2259 for the queued-message
// area, fa20.java:266 for the copy glyph, c0x.java for stream smoothing.

/** An independent cubic-bezier reference: sample the curve densely and take the
 *  y of the sample whose x is nearest. Nothing shared with claudeEase's solver. */
function referenceEase(x: number): number {
  const { x1, y1, x2, y2 } = CLAUDE_EASE
  const point = (a: number, b: number, t: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
  let best = { gap: Infinity, y: 0 }
  for (let step = 0; step <= 20_000; step += 1) {
    const t = step / 20_000
    const gap = Math.abs(point(x1, x2, t) - x)
    if (gap < best.gap) {
      best = { gap, y: point(y1, y2, t) }
    }
  }
  return best.y
}

describe('the Claude app motion numbers', () => {
  it('uses the decompiled values for every constant', () => {
    expect(CLAUDE_EASE).toEqual({ x1: 0.4, y1: 0, x2: 0.2, y2: 1 })
    expect(AGENT_PULSE).toEqual({
      fromAlpha: 1,
      toAlpha: 0.55,
      legMs: 1200,
      phases: 5,
      startDelayMs: 240
    })
    expect(AGENT_PULSE_PERIOD_MS).toBe(2400)
    expect(SCROLL_BUTTON_BESIDE_PILL_FADE_MS).toBe(150)
    expect(QUEUED_MESSAGES_EXPAND_MS).toBe(250)
    expect(COPY_ICON_TINT_MS).toBe(300)
    expect(COPY_CHECK_HOLD_MS).toBe(2000)
    expect(STREAM_SMOOTHING).toEqual({
      smootherTickIntervalMs: 33,
      minMarkdownGroupSizeChars: 800,
      fadeInTailChars: 0,
      fadeInDurationMs: 200,
      catchUpLagMs: 250,
      catchUpMinCharsPerSecond: 80,
      catchUpMaxCharsPerSecond: 600,
      catchUpRateEasingMs: 250,
      revealWithinMs: 450
    })
  })

  it('keeps the copy glyph numbers equal to the code block ones, which read the same composable', () => {
    expect(COPY_ICON_TINT_MS).toBe(CODE_BLOCK_SPEC.copy.tintMs)
    expect(COPY_CHECK_HOLD_MS).toBe(CODE_BLOCK_SPEC.copy.copiedMs)
  })
})

describe('the easing curve cubic-bezier(0.4, 0, 0.2, 1)', () => {
  it('starts at nothing and ends at everything, and clamps outside its range', () => {
    expect(claudeEase(0)).toBe(0)
    expect(claudeEase(1)).toBe(1)
    expect(claudeEase(-0.5)).toBe(0)
    expect(claudeEase(3)).toBe(1)
  })

  it('matches the curve at a spread of points', () => {
    for (const x of [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95]) {
      expect(claudeEase(x)).toBeCloseTo(referenceEase(x), 3)
    }
  })

  it('is slow out, fast through the middle and slow in: the middle is past halfway, the first tenth well short', () => {
    expect(claudeEase(0.5)).toBeGreaterThan(0.75)
    expect(claudeEase(0.1)).toBeLessThan(0.07)
  })
})

/** The app's infinite-repeat spec, ported line by line from `uts.a` (uts.java:22-30), with the
 *  tween's own curve on top: the play position for `elapsed + offset` (nothing played while that
 *  is not positive), alternating direction each leg (Reverse). The offset is `i * -240`, as
 *  cu2.java:1071 builds it. */
function appPulseAlpha(elapsedMs: number, index: number): number {
  const leg = 1200
  const offset = index * -240
  const shifted = elapsedMs + offset
  let position = 0
  if (shifted > 0) {
    const legsDone = Math.floor(shifted / leg)
    position = legsDone % 2 === 0 ? shifted - legsDone * leg : (legsDone + 1) * leg - shifted
  }
  return 1 + (0.55 - 1) * referenceEase(position / leg)
}

describe('the agent pulse', () => {
  it.each([0, 1, 2, 3, 4])(
    'plays what the app’s repeat spec plays for pulse %s, at every sampled time',
    (index) => {
      for (const at of [
        0, 100, 239, 240, 480, 600, 1199, 1200, 1500, 2399, 2400, 3000, 5000, 9999
      ]) {
        expect(agentPulseAlpha(at, index)).toBeCloseTo(appPulseAlpha(at, index), 3)
      }
    }
  )

  it('rests at full alpha, falls to 0.55 after 1200 ms and is back at full after 2400 ms', () => {
    expect(agentPulseAlpha(0, 0)).toBe(1)
    expect(agentPulseAlpha(1200, 0)).toBeCloseTo(0.55, 10)
    expect(agentPulseAlpha(2400, 0)).toBeCloseTo(1, 10)
  })

  it('plays the same curve back on the return leg: the alpha at 600 ms is the alpha at 1800 ms', () => {
    expect(agentPulseAlpha(600, 0)).toBeCloseTo(agentPulseAlpha(1800, 0), 10)
    expect(agentPulseAlpha(300, 0)).toBeCloseTo(agentPulseAlpha(2100, 0), 10)
  })

  it('starts each phase 240 ms after the one before it, holding at full alpha until then', () => {
    for (let phase = 1; phase < 5; phase += 1) {
      const delay = 240 * phase
      expect(agentPulseAlpha(0, phase)).toBe(1)
      expect(agentPulseAlpha(delay, phase)).toBe(1)
      for (const after of [100, 700, 1200, 1900, 2500]) {
        expect(agentPulseAlpha(delay + after, phase)).toBeCloseTo(agentPulseAlpha(after, 0), 10)
      }
    }
    // Phase 1 is still at full alpha when phase 0 has already begun to fall.
    expect(agentPulseAlpha(100, 1)).toBeGreaterThan(agentPulseAlpha(100, 0))
  })

  it('rests at full alpha before the pulses start', () => {
    expect(agentPulseAlpha(-500, 0)).toBe(1)
    expect(agentPulseAlpha(-1, 3)).toBe(1)
  })

  it('shares five pulses between any number of agents: the sixth agent follows the first', () => {
    for (const at of [0, 333, 1200, 2000]) {
      expect(agentPulseAlpha(at, 5)).toBeCloseTo(agentPulseAlpha(at, 0), 10)
      expect(agentPulseAlpha(at, 12)).toBeCloseTo(agentPulseAlpha(at, 2), 10)
    }
  })

  it('folds a negative id into the five, as floorMod does', () => {
    expect(agentPulseAlpha(500, -1)).toBeCloseTo(agentPulseAlpha(500, 4), 10)
  })

  it('never leaves the 0.55 to 1 band, over a whole cycle and far past it', () => {
    for (let at = -5000; at <= 20_000; at += 37) {
      for (let phase = 0; phase < 5; phase += 1) {
        const alpha = agentPulseAlpha(at, phase)
        expect(alpha).toBeGreaterThanOrEqual(0.55 - 1e-9)
        expect(alpha).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })
})
