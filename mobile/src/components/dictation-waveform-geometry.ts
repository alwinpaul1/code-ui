/**
 * The dictation waveform's geometry, as the Claude app draws it (1.261009.20, decompiled:
 * `w330.a` is the composable, `r44` case 1 its draw loop, `psh.D` the level history, `kcw.c` its
 * 25 dp height). A scrolling history: the newest sample at the right edge, one bar per 60 ms
 * sample, older ones moving left until the row is full. Silence is a round dot, voice a taller
 * rounded bar. Pure and worklet-safe, so the UI thread can run it on every frame.
 *
 * One reading of the decompile is kept as found: a bar's left edge is `contentWidth − offset +
 * margin`, so the newest bar starts at the right edge itself, where the edge falloff has shrunk it
 * to nothing; it grows as it scrolls in. The view clips the 3 dp it overhangs.
 */

export const WAVEFORM_BAR_WIDTH = 3
export const WAVEFORM_BAR_GAP = 3
/** One bar per sample slot (`r44`: `jH % 60`). */
export const WAVEFORM_SAMPLE_MS = 60
/** `psh.D` drops samples older than this. */
export const WAVEFORM_HISTORY_MS = 5000
/** A bar whose nearest sample is further away than this draws as silence. */
export const WAVEFORM_SILENCE_GAP_MS = 750
/** Bars within this many pitches of either edge shrink by sqrt(1 − p²). */
export const WAVEFORM_EDGE_PITCHES = 3
/** `kcw.c`. */
export const WAVEFORM_HEIGHT = 25

const PITCH = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP

export type LevelSample = { readonly at: number; readonly level: number }

export type WaveformBar = {
  /** 0 is the newest sample, at the right. */
  readonly index: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly radius: number
  /** Level above zero: drawn in the voiced colour, else the silent one. */
  readonly voiced: boolean
}

function clamp01(value: number): number {
  'worklet'
  if (!(value > 0)) {
    return 0
  }
  return Math.min(1, value)
}

/** The history with one more sample, trimmed to the last five seconds (`psh.D`). */
export function appendLevelSample(
  history: readonly LevelSample[],
  level: number,
  at: number
): LevelSample[] {
  'worklet'
  const next: LevelSample[] = []
  const oldest = at - WAVEFORM_HISTORY_MS
  for (let i = 0; i < history.length; i++) {
    const sample = history[i]!
    if (sample.at >= oldest) {
      next.push(sample)
    }
  }
  next.push({ at, level: clamp01(level) })
  return next
}

/** The start of the 60 ms slot `now` falls in, when no sample has been taken in it yet. */
export function levelSampleDue(lastSampleAt: number | null, now: number): number | null {
  'worklet'
  const slot = now - (now % WAVEFORM_SAMPLE_MS)
  return lastSampleAt === null || slot > lastSampleAt ? slot : null
}

/** The level the bar for time `t` shows: the nearest sample's, 0 when that is over 750 ms away,
 *  and null (draw nothing) before the first sample. */
export function waveformLevelAt(history: readonly LevelSample[], t: number): number | null {
  'worklet'
  if (history.length === 0 || t < history[0]!.at) {
    return null
  }
  let best = Number.POSITIVE_INFINITY
  let level = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const distance = Math.abs(history[i]!.at - t)
    if (distance < best) {
      best = distance
      level = history[i]!.level
    }
  }
  return best > WAVEFORM_SILENCE_GAP_MS ? 0 : level
}

/** Whole bars that fit across `width`. */
export function waveformBarCount(width: number): number {
  'worklet'
  if (!(width > WAVEFORM_BAR_WIDTH)) {
    return 0
  }
  return Math.max(0, Math.floor((width - WAVEFORM_BAR_WIDTH) / PITCH))
}

/** Bar `index` (0 = newest) at time `now`, or null where there is no sample to show. */
export function waveformBar(
  index: number,
  history: readonly LevelSample[],
  now: number,
  width: number,
  height: number
): WaveformBar | null {
  'worklet'
  const count = waveformBarCount(width)
  if (index < 0 || index >= count || height <= 0) {
    return null
  }
  const phase = now % WAVEFORM_SAMPLE_MS
  const level = waveformLevelAt(history, now - phase - index * WAVEFORM_SAMPLE_MS)
  if (level === null) {
    return null
  }
  const contentWidth = count * PITCH + WAVEFORM_BAR_WIDTH
  const margin = (width - contentWidth) / 2
  const edge = WAVEFORM_EDGE_PITCHES * PITCH
  // Distance of the bar from the right end of the content, moving left as the clock runs.
  const offset = index * PITCH + (phase * PITCH) / WAVEFORM_SAMPLE_MS
  const farSide = offset + WAVEFORM_BAR_WIDTH
  let p = 0
  if (offset < edge) {
    p = 1 - offset / edge
  } else if (farSide > contentWidth - edge) {
    p = 1 - (contentWidth - farSide) / edge
  }
  p = clamp01(p)
  const barHeight =
    (level * (height - WAVEFORM_BAR_WIDTH) + WAVEFORM_BAR_WIDTH) * Math.sqrt(1 - p * p)
  return {
    index,
    x: contentWidth - offset + margin,
    y: (height - barHeight) / 2,
    width: WAVEFORM_BAR_WIDTH,
    height: barHeight,
    radius: WAVEFORM_BAR_WIDTH / 2,
    voiced: level !== 0
  }
}

/** Every bar there is something to draw for, newest first. */
export function waveformBars(
  history: readonly LevelSample[],
  now: number,
  width: number,
  height: number
): WaveformBar[] {
  'worklet'
  const bars: WaveformBar[] = []
  const count = waveformBarCount(width)
  for (let i = 0; i < count; i++) {
    const bar = waveformBar(i, history, now, width, height)
    if (bar) {
      bars.push(bar)
    }
  }
  return bars
}

/**
 * A bar drawn from three views whose layout never changes: a 3 dp round cap at the top, one at the
 * bottom, and a 3 dp wide strip the full row tall between them, all centred on the row. Only
 * transforms move them, so a bar's height and its position reach the screen in the same frame.
 * (Animating `height` sent it through a layout commit while the transform went straight to the
 * view, and the two landed frames apart: the waveform shivered, device 0.9.157, 2026-10-17.)
 *
 * - `capOffset`: how far each cap's centre sits from the row's centre (up for the top cap).
 * - `capScaleY`: a bar shorter than the 3 dp cap squashes both caps into one, as the Claude app's
 *   `drawRoundRect` clamps its corner radius to half the height.
 * - `bodyScaleY`: the strip's scale against its full-row height, filling between the caps.
 */
export type WaveformBarParts = {
  readonly capOffset: number
  readonly capScaleY: number
  readonly bodyScaleY: number
}

export function waveformBarParts(barHeight: number, rowHeight: number): WaveformBarParts {
  'worklet'
  const h = barHeight > 0 ? Math.min(barHeight, rowHeight) : 0
  const cap = WAVEFORM_BAR_WIDTH
  return {
    capOffset: Math.max(0, (h - cap) / 2),
    capScaleY: Math.min(1, h / cap),
    bodyScaleY: rowHeight > 0 ? Math.max(0, h - cap) / rowHeight : 0
  }
}
