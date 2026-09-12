import { describe, expect, it } from 'vitest'
import { INLINE_CODE_CHIP_MAX_CHARS, splitInlineCodeChips } from './mobile-markdown-code-chip-split'

describe('splitInlineCodeChips', () => {
  it('keeps a span that fits on one line as a single pill', () => {
    expect(splitInlineCodeChips('pnpm install')).toEqual(['pnpm install'])
    expect(splitInlineCodeChips('a'.repeat(INLINE_CODE_CHIP_MAX_CHARS))).toHaveLength(1)
  })

  it('cuts a long path after a slash, like the Claude app', () => {
    expect(splitInlineCodeChips('~/Desktop/code-ui-android-v0.5.17-139.apk')).toEqual([
      '~/Desktop/',
      'code-ui-android-v0.5.17-139.apk'
    ])
  })

  it('packs short path segments back together up to the width', () => {
    expect(splitInlineCodeChips('mobile/src/session/MobileNativeChatImageStrip.tsx')).toEqual([
      'mobile/src/session/',
      'MobileNativeChatImageStrip.tsx'
    ])
  })

  it('cuts a long command at spaces', () => {
    expect(
      splitInlineCodeChips('cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint')
    ).toEqual(['cd mobile && npx tsc --noEmit && ', 'npx vitest run && npx oxlint'])
  })

  it('falls back to dashes, then a hard cut, for one unbroken token', () => {
    expect(splitInlineCodeChips('very-long-kebab-identifier-that-keeps-going-on')).toEqual([
      'very-long-kebab-identifier-that-',
      'keeps-going-on'
    ])
    const solid = 'x'.repeat(INLINE_CODE_CHIP_MAX_CHARS * 2 + 3)
    const pieces = splitInlineCodeChips(solid)
    expect(pieces.join('')).toBe(solid)
    expect(pieces.every((p) => p.length <= INLINE_CODE_CHIP_MAX_CHARS)).toBe(true)
  })

  it('returns nothing for an empty span', () => {
    expect(splitInlineCodeChips('')).toEqual([])
  })
})
