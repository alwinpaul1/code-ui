import { describe, expect, it } from 'vitest'
import { androidSpScale } from './android-font-scale'

// Values from AOSP's FontScaleConverterFactory tables (android14-release,
// android15-release) and its interpolation, worked by hand.
describe("Android's sp to dp at a system font size", () => {
  it('is linear up to Android 13', () => {
    expect(androidSpScale(1.3, 33).toDp(15)).toBeCloseTo(19.5, 9)
    expect(androidSpScale(2, 33).toDp(15)).toBeCloseTo(30, 9)
    expect(androidSpScale(2, 33).toDp(300)).toBeCloseTo(600, 9)
    expect(androidSpScale(1, 34).toDp(15)).toBe(15)
  })

  it("follows Android 14's curve at 200%: 14 sp is 26 dp and 15 sp 27, and 100 sp and up do not grow", () => {
    const at200 = androidSpScale(2, 34)
    expect(at200.toDp(14)).toBeCloseTo(26, 6)
    expect(at200.toDp(15)).toBeCloseTo(27, 6)
    // A pill's 16.5 sp line.
    expect(at200.toDp(16.5)).toBeCloseTo(28.5, 6)
    expect(at200.toDp(100)).toBeCloseTo(100, 6)
    expect(at200.toDp(250)).toBeCloseTo(250, 6)
    // Below the first entry, from nothing: 8 sp is 16 dp.
    expect(at200.toDp(4)).toBeCloseTo(8, 6)
    // Between 30 and 100 sp: 38 dp to 100.
    expect(at200.toDp(65)).toBeCloseTo(69, 6)
  })

  it('reads a scale between two tables from both, as Android 14 does', () => {
    // 140% lies halfway between the 130% and 150% tables.
    const at140 = androidSpScale(1.4, 34)
    expect(at140.toDp(14)).toBeCloseTo(20.4, 5)
    expect(at140.toDp(15)).toBeCloseTo(21, 5)
  })

  it('is linear on Android 14 below 113% and past 200%, where Android 15 has curves from 103%', () => {
    expect(androidSpScale(1.1, 34).toDp(14)).toBeCloseTo(15.4, 6)
    expect(androidSpScale(1.1, 35).toDp(14)).toBeCloseTo(15.6, 6)
    expect(androidSpScale(1.12, 34).toDp(10)).toBeCloseTo(11.2, 6)
    expect(androidSpScale(1.02, 36).toDp(10)).toBeCloseTo(10.2, 6)
    expect(androidSpScale(2.2, 34).toDp(15)).toBeCloseTo(33, 6)
  })

  it('turns dp back into the sp it came from', () => {
    for (const [scale, api] of [
      [1.3, 33],
      [1.15, 34],
      [1.4, 34],
      [2, 34],
      [1.05, 36]
    ] as const) {
      const sp = androidSpScale(scale, api)
      for (const size of [4, 14, 16.5, 42, 120, 400]) {
        expect(sp.toSp(sp.toDp(size)), `${scale} on ${api}: ${size}`).toBeCloseTo(size, 6)
      }
    }
  })

  it('keeps a missing or broken font scale at 1', () => {
    expect(androidSpScale(0, 34).toDp(15)).toBe(15)
    expect(androidSpScale(Number.NaN, 34).toDp(15)).toBe(15)
  })
})
