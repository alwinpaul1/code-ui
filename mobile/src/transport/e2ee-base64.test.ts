import { describe, expect, it } from 'vitest'
import { base64ToUint8, uint8ToBase64 } from './base64-bytes'

function reference(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

describe('relay base64', () => {
  it('encodes every byte value the way one-char-at-a-time did', () => {
    const all = new Uint8Array(256).map((_, i) => i)

    expect(uint8ToBase64(all)).toBe(reference(all))
  })

  it('agrees with the per-character encoder across chunk boundaries', () => {
    // The encoder now batches; a payload that straddles the batch size is where
    // a bad boundary would show up, and an image paste is exactly that size.
    for (const size of [0, 1, 8191, 8192, 8193, 16384, 100_000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff)

      expect(uint8ToBase64(bytes)).toBe(reference(bytes))
    }
  })

  it('round-trips a payload the size of a pasted screenshot', () => {
    // 512 KB exercises every batch boundary; 2 MB only made the per-character
    // reference decoder in this file slow enough to look like a hang.
    const bytes = new Uint8Array(512 * 1024).map((_, i) => (i * 17) & 0xff)

    expect(base64ToUint8(uint8ToBase64(bytes))).toEqual(bytes)
  })
})
