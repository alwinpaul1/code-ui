import { describe, expect, it, vi } from 'vitest'
import { decodeBase64Bytes, encodeBase64Bytes } from './base64-byte-codec'

describe('base64 byte codec', () => {
  it('uses native encoding on the original byte view without building binary strings', () => {
    class NativeBase64Bytes extends Uint8Array {
      toBase64(): string {
        return Buffer.from(this).toString('base64')
      }
    }
    const bytes = new NativeBase64Bytes(new Uint8Array([9, 255, 254, 8]).buffer, 1, 2)
    const nativeEncoder = vi.spyOn(bytes, 'toBase64')
    const binaryEncoder = vi.spyOn(globalThis, 'btoa')
    try {
      expect(encodeBase64Bytes(bytes)).toBe('//4=')
      expect(nativeEncoder).toHaveBeenCalledExactlyOnceWith()
      expect(binaryEncoder).not.toHaveBeenCalled()
    } finally {
      binaryEncoder.mockRestore()
    }
  })

  it('keeps the fallback when the native property is not callable', () => {
    const bytes = new Uint8Array([255, 254])
    Object.defineProperty(bytes, 'toBase64', { value: undefined })
    expect(encodeBase64Bytes(bytes)).toBe('//4=')
  })

  it('preserves empty encoding for a detached byte view', () => {
    const bytes = new Uint8Array([1, 2, 3])
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
    expect(encodeBase64Bytes(bytes)).toBe('')
  })

  it.each([0, 1, 2, 3, 4, 8190 - 1, 8190, 8190 + 1, 8190 + 2, 8190 * 2, 256 * 1024 + 1])(
    'preserves all bytes and padding at size %i',
    (length) => {
      const backing = new Uint8Array(length + 7)
      for (let index = 0; index < backing.length; index++) {
        backing[index] = (index * 97 + 13) % 256
      }
      const bytes = backing.subarray(3, length + 3)
      const encoded = encodeBase64Bytes(bytes)
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'))
      expect(decodeBase64Bytes(encoded)).toEqual(bytes)
    }
  )

  it.each(['', 'AA', 'AQ==', 'AR==', 'A Q==', 'AQ==\n', '/w==', '//8=', '////'])(
    'keeps the existing atob decoding behavior for %j',
    (value) => {
      expect(decodeBase64Bytes(value)).toEqual(new Uint8Array(Buffer.from(atob(value), 'latin1')))
    }
  )

  it.each(['A', 'A===', 'A!AA', '_w==', 'πAAA', 'AA=AA'])(
    'rejects malformed base64: %j',
    (value) => {
      expect(() => atob(value)).toThrow()
      expect(() => decodeBase64Bytes(value)).toThrow()
    }
  )

  // Cross-checked against Buffer over random lengths that straddle every chunk boundary, with
  // random bytes and a random subarray offset, so a bad boundary or a wrong padding shows up.
  it('matches Buffer on random bytes across chunk boundaries', () => {
    let seed = 0x5eed1234
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    const sizes = [0, 1, 2, 3, 8189, 8190, 8191, 8192, 16379, 16380, 16381, 24570, 24571]
    for (let round = 0; round < 40; round++) {
      sizes.push(random() % 70_000)
    }
    for (const length of sizes) {
      const offset = random() % 5
      const backing = new Uint8Array(length + offset)
      for (let index = 0; index < backing.length; index++) {
        backing[index] = random() & 0xff
      }
      const bytes = backing.subarray(offset)
      const encoded = encodeBase64Bytes(bytes)
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'))
      expect(decodeBase64Bytes(encoded)).toEqual(bytes)
    }
  })

  // The speed guard is a count, not a clock, so load cannot flake it. Building each chunk one byte
  // at a time calls String.fromCharCode once per byte (measured 6-7x slower than converting a
  // chunk per call on a JIT-less engine, which is what Hermes is); a chunk per call makes about one
  // call per 8190 bytes.
  //
  // Node (and any engine with Uint8Array.prototype.toBase64) takes the native path and never calls
  // String.fromCharCode, which would pass this guard without testing anything, so the native
  // encoder is hidden on this view to drive the chunked fallback Hermes may still run.
  it('converts a chunk of bytes per String.fromCharCode call, not one byte per call', () => {
    const bytes = new Uint8Array(1 << 20).map((_, index) => (index * 31) & 0xff)
    Object.defineProperty(bytes, 'toBase64', { value: undefined })
    const spy = vi.spyOn(String, 'fromCharCode')
    try {
      expect(encodeBase64Bytes(bytes)).toBe(Buffer.from(bytes).toString('base64'))
      expect(spy.mock.calls.length).toBeLessThanOrEqual(Math.ceil(bytes.length / 8190) + 1)
    } finally {
      spy.mockRestore()
    }
  })
})
