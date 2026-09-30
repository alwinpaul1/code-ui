import { describe, expect, it } from 'vitest'
import { MOBILE_CHUNKED_READ_MAX_BYTES } from './mobile-file-chunked-read'
import { formatPreviewByteLength } from './mobile-file-preview-response'

// The file preview and the save toast said "1024 KB" for 1,048,064 to
// 1,048,575 bytes: the formatter chose KB before rounding, and a count just
// under a MiB rounded up to 1024 of them (review, 2026-09-30). It now rounds
// first and names the unit of what it rounded to.

const KIB = 1024
const MIB = 1024 * KIB
const GIB = 1024 * MIB

describe('a file size at the edge of each unit', () => {
  it.each([
    [1023, '1023 B'],
    [KIB, '1 KB'],
    [1_048_063, '1023 KB'],
    [1_048_064, '1.0 MB'],
    [1_048_575, '1.0 MB'],
    [MIB, '1.0 MB'],
    [1_572_864, '1.5 MB'],
    [10 * MIB - 1, '10.0 MB']
  ])('says %i bytes is %s', (bytes, label) => {
    expect(formatPreviewByteLength(bytes)).toBe(label)
  })

  // Unreachable today: every caller is bounded by the phone's 80 MiB whole-read
  // cap (MOBILE_CHUNKED_READ_MAX_BYTES), which is where the save toast and its
  // progress stop. The same rounding keeps the MB edge honest if that moves.
  it('never says 1024 MB, should a size ever reach a GiB', () => {
    expect(MOBILE_CHUNKED_READ_MAX_BYTES).toBe(80 * MIB)
    expect(formatPreviewByteLength(MOBILE_CHUNKED_READ_MAX_BYTES)).toBe('80.0 MB')
    expect(formatPreviewByteLength(1023 * MIB)).toBe('1023.0 MB')
    expect(formatPreviewByteLength(GIB - 1)).toBe('1.0 GB')
    expect(formatPreviewByteLength(GIB)).toBe('1.0 GB')
    expect(formatPreviewByteLength(3 * GIB)).toBe('3.0 GB')
  })

  it('keeps an empty or unreadable size as it was', () => {
    expect(formatPreviewByteLength(0)).toBe('0 B')
    expect(formatPreviewByteLength(-1)).toBe('unknown size')
    expect(formatPreviewByteLength(Number.NaN)).toBe('unknown size')
  })
})
