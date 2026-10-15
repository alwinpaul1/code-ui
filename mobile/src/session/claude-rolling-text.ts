// The Claude app's rolling figures (`z530.a`, com.anthropic.claude 1.261013.20, jadx 2026-10-15):
// the working footer's "15s · 1,234 tokens" is drawn with every digit in a slot as wide as the
// widest digit, and a digit that changes rolls: the new one slides in from below (from above
// when the figure went down) while the old one slides out the other way.
//
//   runs        z530.a          a run of digits, with "," "." " " or "'" between two digits kept
//                               inside it ("1,234"), is a number; the rest is plain text
//   slot width  z530.a          the widest of "0".."9" measured in the line's style; non-digits
//                               keep their own width
//   direction   z530.a, wk2     the first number whose value changed decides: up (bigger) rolls
//                               upward, down rolls downward
//   motion      z530.y, x, mc   slide by the full height on spring(dampingRatio 0.9, stiffness 380),
//                               fade over 130 ms; per character (`u95`, "numericTextChar")

/** `z530.q`: a digit. */
export function isRollingDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

export type RollingRun = { kind: 'number' | 'plain'; text: string }

/** `z530.a`: the text split into numbers and plain runs. */
export function rollingRuns(text: string): RollingRun[] {
  const runs: RollingRun[] = []
  let plain = ''
  let i = 0
  while (i < text.length) {
    if (!isRollingDigit(text[i]!)) {
      plain += text[i]
      i++
      continue
    }
    let end = i + 1
    while (end < text.length) {
      if (isRollingDigit(text[end]!)) {
        end++
      } else if (",.  '".includes(text[end]!) && end + 1 < text.length && isRollingDigit(text[end + 1]!)) {
        end += 2
      } else {
        break
      }
    }
    if (plain) {
      runs.push({ kind: 'plain', text: plain })
      plain = ''
    }
    runs.push({ kind: 'number', text: text.slice(i, end) })
    i = end
  }
  if (plain) {
    runs.push({ kind: 'plain', text: plain })
  }
  return runs
}

function numbers(text: string): number[] {
  return rollingRuns(text)
    .filter((run) => run.kind === 'number')
    .map((run) => Number(run.text.replace(/[^0-9]/g, '')))
}

/** Whether a change from `previous` to `next` rolls upward: the first number (counted from the
 *  end, as the app keys them) whose value changed went up. Unchanged numbers keep `fallback`. */
export function rollsUpward(previous: string, next: string, fallback = true): boolean {
  const before = numbers(previous).toReversed()
  const after = numbers(next).toReversed()
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (before[i] !== after[i]) {
      return after[i]! > before[i]!
    }
  }
  return fallback
}

/** The characters of a line keyed from its end, so "9s" to "10s" keeps the "s" and the units
 *  digit in their slots and adds a tens digit in front, as the app's end-keyed runs do. */
export function rollingSlots(text: string): { key: string; ch: string; digit: boolean }[] {
  const chars = [...text]
  return chars.map((ch, index) => ({ key: `c${chars.length - 1 - index}`, ch, digit: isRollingDigit(ch) }))
}

/** `z530.y`: the slide spring, as React Native's Animated takes it (mass 1). */
export const ROLLING_SPRING = { stiffness: 380, damping: 2 * 0.9 * Math.sqrt(380), mass: 1 } as const
/** `z530.x`: the fade, ms. */
export const ROLLING_FADE_MS = 130
