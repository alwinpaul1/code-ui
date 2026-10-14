/**
 * The microphone level for the dictation waveform, read from the 16-bit PCM the Anthropic engine
 * already streams (16 kHz mono, little-endian, about 32 ms a chunk).
 *
 * The Claude app maps Android's recogniser `rmsdB` linearly: clamp((rmsdB + 2) / 12, 0, 1)
 * (1.261009.20, b90.java:86), so 0 is silence and 1 is loud speech across a 12 dB span of a
 * smoothed, gain-adjusted scale. Raw PCM has no such scale, so the same linear-in-dB shape is put
 * on dBFS with constants for a phone held to talk into:
 *
 * - FLOOR -50 dBFS: a quiet room sits around -60 to -50, so it reads 0 and the waveform draws dots
 *   (the waveform tells silence from voice by a level of exactly 0).
 * - CEILING -20 dBFS: conversational speech at the phone runs about -35 to -25 and reads 0.5 to
 *   0.8; a raised voice reaches the top. The span is 30 dB, wider than Claude's 12, because raw
 *   RMS swings much more than the recogniser's smoothed figure.
 *
 * No extra smoothing: the waveform takes one sample per 60 ms, and a 32 ms chunk already averages
 * 512 samples.
 */
export const PCM_LEVEL_FLOOR_DBFS = -50
export const PCM_LEVEL_CEILING_DBFS = -20

/** The level of one chunk, 0..1. Null for an empty or odd-length chunk: half a sample is not
 *  audio this reader can place, so the caller keeps the last level. */
export function pcm16Level(data: Uint8Array): number | null {
  if (data.byteLength === 0 || data.byteLength % 2 !== 0) {
    return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = data.byteLength / 2
  let sum = 0
  for (let i = 0; i < count; i++) {
    const sample = view.getInt16(i * 2, true) / 32768
    sum += sample * sample
  }
  const rms = Math.sqrt(sum / count)
  if (rms === 0) {
    return 0
  }
  const dbfs = 20 * Math.log10(rms)
  const level = (dbfs - PCM_LEVEL_FLOOR_DBFS) / (PCM_LEVEL_CEILING_DBFS - PCM_LEVEL_FLOOR_DBFS)
  return Math.min(1, Math.max(0, level))
}

/** A level that changes many times a second, held outside React so a chunk does not re-render
 *  the screen. The waveform subscribes and copies it to the UI thread. */
export type LevelSource = {
  readonly current: number
  set: (level: number) => void
  subscribe: (listener: (level: number) => void) => () => void
}

export function createLevelSource(): LevelSource {
  let current = 0
  const listeners = new Set<(level: number) => void>()
  return {
    get current() {
      return current
    },
    set(level) {
      if (level === current) {
        return
      }
      current = level
      for (const listener of listeners) {
        listener(level)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
