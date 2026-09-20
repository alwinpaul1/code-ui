import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// 2026-09-20: "the input and the chip above [were] transparent, now it's not
// there". The dock — the Working/Tools strip and the ground under the
// composer — had been see-through since 2026-09-13 (bgDock, alpha 0.72) and
// was made opaque on 2026-09-19 to hide a row scrolled under the strip. That
// was the look, not a bug. A source pin on the style block, since the styles
// module needs React Native to load: the `dock:` block's background must be
// the glass token, and the token must be translucent in both themes.
describe('the composer dock', () => {
  it('is drawn on the see-through ground', () => {
    const source = readFileSync(new URL('./mobile-native-chat-view-styles.ts', import.meta.url), 'utf8')
    const dock = /dock:\s*\{[\s\S]*?\n\s*\}/.exec(source)?.[0] ?? ''
    // Code, not the comment above it: the property line itself.
    expect(dock).toMatch(/\n\s*backgroundColor:\s*colors\.bgDock\s*\n/)
    expect(dock).not.toMatch(/\n\s*backgroundColor:\s*colors\.bg\s*\n/)
  })

  for (const [name, palette] of [
    ['light', lightColors],
    ['dark', darkColors]
  ] as const) {
    it(`has a translucent ground in ${name}`, () => {
      const alpha = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(palette.bgDock)?.[1]
      expect(Number(alpha)).toBeLessThan(1)
      expect(Number(alpha)).toBeGreaterThan(0.5)
    })
  }
})
