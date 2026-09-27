/**
 * Android's sp to dp at a system font size, for the phone model
 * (mobile-markdown-code-pill-phone.test-support.ts): AOSP
 * FontScaleConverterFactory's tables at the scales the model draws, kept
 * apart from the app's own (android-font-scale.ts), so a test of one is not
 * the other agreeing with itself.
 */

export type Placeholder = { system: number; curve: boolean }

const FROM_SP = [8, 10, 12, 14, 18, 20, 24, 30, 100]
const TO_DP: Readonly<Record<string, readonly number[]>> = {
  '1.15': [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100],
  '1.3': [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100],
  '1.5': [12, 15, 18, 22, 24, 26, 28, 30, 100],
  '1.8': [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100],
  '2': [16, 20, 24, 26, 30, 34, 36, 38, 100]
}

/** A value in sp in dp: linear, or on a table's curve. */
export function spToDp(sp: number, system: number, curve: boolean): number {
  const table = curve ? TO_DP[String(system)] : undefined
  if (!table) {
    return sp * system
  }
  if (sp >= 100) {
    return sp
  }
  if (sp <= 8) {
    return (sp * table[0]!) / 8
  }
  for (let i = 0; i < FROM_SP.length - 1; i += 1) {
    if (sp <= FROM_SP[i + 1]!) {
      const t = (sp - FROM_SP[i]!) / (FROM_SP[i + 1]! - FROM_SP[i]!)
      return table[i]! + t * (table[i + 1]! - table[i]!)
    }
  }
  return sp
}

/** The room an inline view of this frame takes on its line. */
export function placeholderWidth(frame: number, placeholder: Placeholder | undefined): number {
  return placeholder ? spToDp(frame, placeholder.system, placeholder.curve) : frame
}
