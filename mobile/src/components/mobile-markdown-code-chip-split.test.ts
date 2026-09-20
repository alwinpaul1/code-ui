import { describe, expect, it } from 'vitest'
import {
  INLINE_CODE_CHIP_MAX_CHARS,
  inlineCodeChipMaxChars,
  splitInlineCodeChips
} from './mobile-markdown-code-chip-split'

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

// 2026-09-20, phone: `.claude/worktrees/agent-a1922af126912f522` drew as two
// pills side by side on one line. The cut was the fixed 34-character cap;
// the line, 372 dp on this device at 13 dp mono, holds 45.
describe('a span that fits the line is one pill', () => {
  const path = '.claude/worktrees/agent-a1922af126912f522'
  it('is not cut when the measured line holds it', () => {
    const max = inlineCodeChipMaxChars(372, 13)
    expect(max).toBe(45)
    expect(splitInlineCodeChips(path, max)).toEqual([path])
  })
  it('is still cut, after the slash, on a line that cannot hold it', () => {
    const max = inlineCodeChipMaxChars(300, 13)
    expect(max).toBe(36)
    expect(splitInlineCodeChips(path, max)).toEqual(['.claude/worktrees/', 'agent-a1922af126912f522'])
  })
  it('keeps the fixed cap until the paragraph has been measured', () => {
    expect(inlineCodeChipMaxChars(0, 13)).toBe(INLINE_CODE_CHIP_MAX_CHARS)
    expect(inlineCodeChipMaxChars(60, 13)).toBe(12)
  })
})
