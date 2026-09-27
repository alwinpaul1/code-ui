/**
 * How Android turns a size in sp into dp at the reader's system font size
 * (Settings > Display > Font size; PixelRatio.getFontScale()).
 *
 * Up to Android 13 it is linear: sp times the font scale. From Android 14
 * (API 34) TypedValue.applyDimension runs sp through a curve instead
 * (FontScaleConverterFactory), so large type grows less than small: at 200%,
 * 14 sp is 26 dp and 15 sp 27, not 28 and 30, and from 100 sp on nothing
 * grows at all. React Native converts every text size and line height this
 * way (TextAttributes.kt), and an inline view's room on its line too
 * (TextLayoutManager.kt sizes the placeholder with toPixelFromSP of the
 * view's frame), so the code pills are priced with it.
 *
 * The tables, and how a scale between two of them is read, are AOSP's
 * (frameworks/base core/java/android/content/res, android14-release and
 * android15-release; android-36.1 matches 15). Android 14 has curves for
 * 115% to 200%; Android 15 added 105%, 110% and 120%. Outside the tables the
 * scale is linear again.
 */

export type SpScale = {
  /** dp for a size in sp. */
  toDp: (sp: number) => number
  /** sp for a size in dp: the inverse. */
  toSp: (dp: number) => number
}

const COMMON_SP = [8, 10, 12, 14, 18, 20, 24, 30, 100]

type Table = { key: number; dp: readonly number[] }

/** toDp of COMMON_SP at each scale. */
const TABLES: Readonly<Record<string, readonly number[]>> = {
  '1.05': [8.4, 10.5, 12.6, 14.8, 18.6, 20.6, 24.4, 30, 100],
  '1.1': [8.8, 11, 13.2, 15.6, 19.2, 21.2, 24.8, 30, 100],
  '1.15': [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100],
  '1.2': [9.6, 12, 14.4, 17.2, 20.4, 22.4, 25.6, 30, 100],
  '1.3': [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100],
  '1.5': [12, 15, 18, 22, 24, 26, 28, 30, 100],
  '1.8': [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100],
  '2': [16, 20, 24, 26, 30, 34, 36, 38, 100]
}
const ANDROID_14 = ['1.15', '1.3', '1.5', '1.8', '2']
const ANDROID_15 = ['1.05', '1.1', '1.15', '1.2', '1.3', '1.5', '1.8', '2']

/** FontScaleConverterFactory.getKey, in float as Java computes it. */
function key(scale: number): number {
  return Math.trunc(Math.fround(Math.fround(scale) * 100))
}

/** FontScaleConverterImpl.lookupAndInterpolate. */
function lookup(value: number, from: readonly number[], to: readonly number[]): number {
  const positive = Math.abs(value)
  const sign = Math.sign(value)
  const exact = from.indexOf(positive)
  if (exact !== -1) {
    return sign * to[exact]!
  }
  let lower = -1
  while (lower + 1 < from.length && from[lower + 1]! < positive) {
    lower += 1
  }
  if (lower >= from.length - 1) {
    // Past the table: the last pair's ratio, 1 for every table here.
    return value * (to[from.length - 1]! / from[from.length - 1]!)
  }
  const [fromStart, toStart] = lower === -1 ? [0, 0] : [from[lower]!, to[lower]!]
  const [fromEnd, toEnd] = [from[lower + 1]!, to[lower + 1]!]
  const t = Math.min(1, Math.max(0, (positive - fromStart) / (fromEnd - fromStart)))
  return sign * (toStart + t * (toEnd - toStart))
}

function linear(fontScale: number): SpScale {
  return { toDp: (sp) => sp * fontScale, toSp: (dp) => dp / fontScale }
}

function curve(dp: readonly number[]): SpScale {
  return { toDp: (sp) => lookup(sp, COMMON_SP, dp), toSp: (value) => lookup(value, dp, COMMON_SP) }
}

/**
 * The sp to dp conversion Android uses at `fontScale` on `apiLevel`
 * (Platform.Version). FontScaleConverterFactory.forScale: linear below the
 * first table (less a hundredth, two on Android 14), a table's own curve at
 * its scale, a curve between two tables' values in between, and linear past
 * the last.
 */
export function androidSpScale(fontScale: number, apiLevel: number): SpScale {
  if (!(fontScale > 0) || apiLevel < 34) {
    return linear(fontScale > 0 ? fontScale : 1)
  }
  const tables: Table[] = (apiLevel >= 35 ? ANDROID_15 : ANDROID_14).map((scale) => ({
    key: key(Number(scale)),
    dp: TABLES[scale]!
  }))
  const lowest = Math.fround(tables[0]!.key / 100 - (apiLevel >= 35 ? 0.01 : 0.02))
  if (Math.fround(fontScale) < lowest) {
    return linear(fontScale)
  }
  const wanted = key(fontScale)
  const same = tables.find((table) => table.key === wanted)
  if (same) {
    return curve(same.dp)
  }
  const higher = tables.findIndex((table) => table.key > wanted)
  if (higher <= 0) {
    return linear(fontScale)
  }
  const [start, end] = [tables[higher - 1]!, tables[higher]!]
  const point = Math.min(1, Math.max(0, (fontScale - start.key / 100) / (end.key / 100 - start.key / 100)))
  const startCurve = curve(start.dp)
  const endCurve = curve(end.dp)
  return curve(COMMON_SP.map((sp) => startCurve.toDp(sp) + point * (endCurve.toDp(sp) - startCurve.toDp(sp))))
}
