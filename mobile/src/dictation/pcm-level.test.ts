import { describe, expect, it } from 'vitest'
import { createLevelSource, pcm16Level, PCM_LEVEL_FLOOR_DBFS, PCM_LEVEL_CEILING_DBFS } from './pcm-level'

/** `count` samples of a sine at `amplitude` (0..1 of full scale), as 16-bit little-endian PCM. */
function sine(amplitude: number, count = 512): Uint8Array {
  const bytes = new Uint8Array(count * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < count; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * amplitude * 32767)
    view.setInt16(i * 2, sample, true)
  }
  return bytes
}

/** A sine whose RMS sits at `dbfs`. */
const atDbfs = (dbfs: number): Uint8Array => sine(Math.SQRT2 * 10 ** (dbfs / 20))

describe('the microphone level from the PCM the Anthropic engine streams', () => {
  it('reads silence as 0, so the waveform draws dots', () => {
    expect(pcm16Level(new Uint8Array(1024))).toBe(0)
    // A quiet room, below the floor.
    expect(pcm16Level(atDbfs(PCM_LEVEL_FLOOR_DBFS - 6))).toBe(0)
  })

  it('reads speech as a level well inside 0..1, so the waveform draws bars', () => {
    const conversational = pcm16Level(atDbfs(-30))!
    expect(conversational).toBeGreaterThan(0.3)
    expect(conversational).toBeLessThan(1)
    // Louder speech, a taller bar.
    expect(pcm16Level(atDbfs(-24))!).toBeGreaterThan(conversational)
  })

  it('maps dBFS linearly between the floor and the ceiling, as the Claude app maps rmsdB', () => {
    // Claude (1.261009.20, b90.java:86): clamp((rmsdB + 2) / 12, 0, 1), linear in dB.
    const mid = (PCM_LEVEL_FLOOR_DBFS + PCM_LEVEL_CEILING_DBFS) / 2
    expect(pcm16Level(atDbfs(mid))!).toBeCloseTo(0.5, 1)
  })

  it('caps a clipping, full-scale signal at 1', () => {
    const clipped = new Uint8Array(1024)
    const view = new DataView(clipped.buffer)
    for (let i = 0; i < 512; i++) {
      view.setInt16(i * 2, i % 2 === 0 ? 32767 : -32768, true)
    }
    expect(pcm16Level(clipped)).toBe(1)
    expect(pcm16Level(sine(1))).toBe(1)
  })

  it('ignores an empty or odd-length chunk rather than guess at it', () => {
    expect(pcm16Level(new Uint8Array(0))).toBeNull()
    expect(pcm16Level(new Uint8Array(1))).toBeNull()
    expect(pcm16Level(sine(0.5).subarray(0, 101))).toBeNull()
  })

  it('reads a chunk that is a view into a larger buffer at its own offset', () => {
    const backing = new Uint8Array(2048)
    backing.set(sine(0.5), 1024)
    expect(pcm16Level(backing.subarray(0, 1024))).toBe(0)
    expect(pcm16Level(backing.subarray(1024))).toBe(pcm16Level(sine(0.5)))
  })
})

describe('a level source', () => {
  it('holds the last level and tells its listeners, without React', () => {
    const source = createLevelSource()
    const heard: number[] = []
    const unsubscribe = source.subscribe((level) => heard.push(level))
    source.set(0.4)
    source.set(0.4)
    source.set(0)
    expect(source.current).toBe(0)
    expect(heard).toEqual([0.4, 0])
    unsubscribe()
    source.set(1)
    expect(heard).toEqual([0.4, 0])
  })
})
