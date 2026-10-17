import { describe, expect, it } from 'vitest'
import {
  appendLevelSample,
  levelSampleDue,
  waveformBar,
  waveformBarCount,
  waveformBarParts,
  waveformBars,
  waveformLevelAt,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_EDGE_PITCHES,
  WAVEFORM_HEIGHT,
  WAVEFORM_HISTORY_MS,
  WAVEFORM_SAMPLE_MS,
  WAVEFORM_SILENCE_GAP_MS,
  type LevelSample
} from './dictation-waveform-geometry'

// The Claude app's dictation waveform (1.261009.20, decompiled: `w330.a` draws it, `r44` case 1 is
// the draw loop, `psh.D` keeps the history, `kcw.c` = 25 dp tall). These pin its numbers.

const H = WAVEFORM_HEIGHT
const PITCH = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP

/** One sample every 60 ms from `from` to `to` inclusive, all at `level`. */
function steady(from: number, to: number, level: number): LevelSample[] {
  let history: LevelSample[] = []
  for (let at = from; at <= to; at += WAVEFORM_SAMPLE_MS) {
    history = appendLevelSample(history, level, at)
  }
  return history
}

describe('the dictation waveform’s numbers are the Claude app’s', () => {
  it('draws 3 dp bars 3 dp apart, one per 60 ms sample, 25 dp tall, five seconds of history, silence after 750 ms', () => {
    expect(WAVEFORM_BAR_WIDTH).toBe(3)
    expect(WAVEFORM_BAR_GAP).toBe(3)
    expect(WAVEFORM_SAMPLE_MS).toBe(60)
    expect(WAVEFORM_HEIGHT).toBe(25)
    expect(WAVEFORM_HISTORY_MS).toBe(5000)
    expect(WAVEFORM_SILENCE_GAP_MS).toBe(750)
    expect(WAVEFORM_EDGE_PITCHES).toBe(3)
  })

  it('fits as many whole bars as the width holds, and none in a sliver', () => {
    expect(waveformBarCount(0)).toBe(0)
    expect(waveformBarCount(8)).toBe(0)
    expect(waveformBarCount(9)).toBe(1)
    expect(waveformBarCount(3 + 40 * PITCH)).toBe(40)
    expect(waveformBarCount(3 + 40 * PITCH + 5)).toBe(40)
  })
})

describe('the waveform’s bars', () => {
  const width = 3 + 40 * PITCH
  // On a 60 ms slot boundary, so bar i shows the sample taken i slots ago.
  const now = 166 * WAVEFORM_SAMPLE_MS
  const loud = steady(now - 4000, now, 1)

  it('puts the newest sample at the right and steps one pitch left per older sample', () => {
    const bars = waveformBars(loud, now, width, H)
    expect(bars).toHaveLength(40)
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.x - bars[i]!.x).toBeCloseTo(PITCH)
      expect(bars[i]!.width).toBe(3)
      expect(bars[i]!.radius).toBe(1.5)
    }
    expect(bars[0]!.x).toBeGreaterThan(bars[39]!.x)
  })

  it('scrolls smoothly: 30 ms on, every bar has moved half a pitch to the left', () => {
    const at = waveformBar(10, loud, now, width, H)!
    const later = waveformBar(10, loud, now + 30, width, H)!
    expect(at.x - later.x).toBeCloseTo(PITCH / 2)
  })

  it('makes a bar 3 dp plus its level times the rest of the height, centred', () => {
    for (const level of [0, 0.25, 0.5, 1]) {
      const bar = waveformBar(20, steady(now - 4000, now, level), now, width, H)!
      expect(bar.height).toBeCloseTo(3 + level * (H - 3))
      expect(bar.y).toBeCloseTo((H - bar.height) / 2)
    }
  })

  it('shrinks bars within three pitches of either edge by sqrt(1 − p²)', () => {
    // The newest bar sits on the right edge itself: p = 1, nothing drawn yet.
    expect(waveformBar(0, loud, now, width, H)!.height).toBeCloseTo(0)
    // One pitch in: p = 1 − 6/18.
    const p1 = 1 - PITCH / (3 * PITCH)
    expect(waveformBar(1, loud, now, width, H)!.height).toBeCloseTo(H * Math.sqrt(1 - p1 * p1))
    // Three pitches in: full height.
    expect(waveformBar(3, loud, now, width, H)!.height).toBeCloseTo(H)
    // The oldest bar on the left edge: its far side is one pitch short of the end, p = 1 − 6/18.
    const contentWidth = 40 * PITCH + 3
    const farSide = 39 * PITCH + 3
    const pLeft = 1 - (contentWidth - farSide) / (3 * PITCH)
    expect(waveformBar(39, loud, now, width, H)!.height).toBeCloseTo(H * Math.sqrt(1 - pLeft * pLeft))
  })

  it('draws silence as a round dot in the silent colour and voice as a bar in the voiced one', () => {
    const quiet = waveformBar(20, steady(now - 4000, now, 0), now, width, H)!
    expect(quiet).toMatchObject({ width: 3, height: 3, voiced: false })
    const voiced = waveformBar(20, steady(now - 4000, now, 0.01), now, width, H)!
    expect(voiced.voiced).toBe(true)
  })

  it('grows in from the right: nothing is drawn for time before the first sample', () => {
    const fresh = steady(now - 4 * WAVEFORM_SAMPLE_MS, now, 0)
    const bars = waveformBars(fresh, now, width, H)
    expect(bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3, 4])
  })

  it('draws a dot, not the last bar, once the newest sample is more than 750 ms old', () => {
    const history = appendLevelSample([], 1, 0)
    expect(waveformLevelAt(history, 750)).toBe(1)
    expect(waveformLevelAt(history, 751)).toBe(0)
    expect(waveformLevelAt(history, -1)).toBeNull()
  })

  it('takes the nearest sample to each bar’s time', () => {
    let history: LevelSample[] = []
    history = appendLevelSample(history, 0.2, 0)
    history = appendLevelSample(history, 0.8, 100)
    expect(waveformLevelAt(history, 40)).toBe(0.2)
    expect(waveformLevelAt(history, 70)).toBe(0.8)
  })

  it('draws nothing with no samples, no width or no height', () => {
    expect(waveformBars([], now, width, H)).toEqual([])
    expect(waveformBars(loud, now, 0, H)).toEqual([])
    expect(waveformBars(loud, now, 5, H)).toEqual([])
  })

  it('draws one bar for one sample, and only once it has scrolled in from the edge', () => {
    const one = appendLevelSample([], 1, now)
    const bars = waveformBars(one, now, width, H)
    expect(bars).toHaveLength(1)
    expect(bars[0]!.height).toBeCloseTo(0)
    const later = waveformBars(one, now + 30, width, H)
    expect(later[0]!.height).toBeGreaterThan(0)
  })

  it('fills the whole row once the history is longer than the row, and stays inside it', () => {
    const narrow = 3 + 10 * PITCH
    const bars = waveformBars(loud, now + 30, narrow, H)
    expect(bars).toHaveLength(10)
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0)
      expect(bar.y).toBeGreaterThanOrEqual(0)
      expect(bar.y + bar.height).toBeLessThanOrEqual(H)
    }
  })
})

describe('the level history', () => {
  it('keeps five seconds and forgets anything older', () => {
    const history = steady(0, 8000, 0.5)
    expect(history[0]!.at).toBeGreaterThanOrEqual(8000 - WAVEFORM_HISTORY_MS)
    expect(history[history.length - 1]!.at).toBe(7980)
    expect(history.length).toBe(Math.floor(WAVEFORM_HISTORY_MS / WAVEFORM_SAMPLE_MS) + 1)
  })

  it('clamps a level to 0..1', () => {
    expect(appendLevelSample([], 3, 0)[0]!.level).toBe(1)
    expect(appendLevelSample([], -1, 0)[0]!.level).toBe(0)
    expect(appendLevelSample([], Number.NaN, 0)[0]!.level).toBe(0)
  })

  it('takes one sample per 60 ms slot, whatever the frame rate', () => {
    const taken: number[] = []
    let last: number | null = null
    for (let t = 0; t <= 1000; t += 16.7) {
      const due = levelSampleDue(last, t)
      if (due !== null) {
        taken.push(due)
        last = due
      }
    }
    expect(taken[0]).toBe(0)
    expect(taken).toHaveLength(Math.floor(1000 / WAVEFORM_SAMPLE_MS) + 1)
    for (let i = 1; i < taken.length; i++) {
      expect(taken[i]! - taken[i - 1]!).toBe(WAVEFORM_SAMPLE_MS)
    }
  })
})

describe('a bar built from caps and a strip that only transforms move', () => {
  /** The painted extent about the row's centre: the strip, and two 3 dp caps squashed by capScaleY. */
  function extent(h: number): number {
    const parts = waveformBarParts(h, H)
    const strip = parts.bodyScaleY * H
    const cap = WAVEFORM_BAR_WIDTH * parts.capScaleY
    return Math.max(strip, 2 * parts.capOffset + cap)
  }

  it('paints exactly the bar’s height for a dot, a voiced bar, a full bar and an edge sliver', () => {
    for (const h of [3, 3.5, 11, H, 2, 0.4]) {
      expect(extent(h), `height ${h}`).toBeCloseTo(h, 9)
    }
  })

  it('paints nothing for no height, and never more than the row', () => {
    expect(waveformBarParts(0, H)).toEqual({ capOffset: 0, capScaleY: 0, bodyScaleY: 0 })
    expect(waveformBarParts(Number.NaN, H)).toEqual({ capOffset: 0, capScaleY: 0, bodyScaleY: 0 })
    expect(extent(H + 10)).toBeCloseTo(H, 9)
  })
})
