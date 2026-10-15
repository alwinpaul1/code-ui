import { describe, expect, it } from 'vitest'
import {
  CLAUDE_FOOTER_IDLE_MIN_WIDTH,
  CLAUDE_FOOTER_MARK_GAP,
  CLAUDE_FOOTER_PADDING_HORIZONTAL,
  CLAUDE_FOOTER_PADDING_VERTICAL,
  CLAUDE_FOOTER_SEPARATOR,
  CLAUDE_WORKING_VERBS,
  randomVerbIndex,
  verbChangeDelayMs
} from './claude-working-footer-spec'

// Values from com.anthropic.claude 1.261013.20 (`wm7.a`, `y07`; the verb clock from `l8` in
// 1.261009.20; see the spec file). The working mark's own numbers are in claude-working-mark.test.ts.
describe("the Claude app's working footer, pinned to the decompiled numbers", () => {
  it("leaves 8 dp between the working mark and the words, in the list's 16 dp gutter", () => {
    expect(CLAUDE_FOOTER_MARK_GAP).toBe(8)
    expect(CLAUDE_FOOTER_PADDING_HORIZONTAL).toBe(16)
  })

  it('changes the verb after 3 s, then 4 s, then every 6 s', () => {
    expect([0, 1, 2, 3, 40].map(verbChangeDelayMs)).toEqual([3000, 4000, 6000, 6000, 6000])
  })

  it('has the twenty verbs, first and last as the app lists them', () => {
    expect(CLAUDE_WORKING_VERBS).toHaveLength(20)
    expect(CLAUDE_WORKING_VERBS[0]).toBe('Clauding')
    expect(CLAUDE_WORKING_VERBS[19]).toBe('Brewing')
  })

  it('picks a verb index inside the list at both ends of the random range', () => {
    expect(randomVerbIndex(() => 0)).toBe(0)
    expect(randomVerbIndex(() => 0.999999)).toBe(19)
    expect(randomVerbIndex(() => 1)).toBe(19)
  })

  it('pads 16 dp, keeps the idle count at least 48 dp wide and separates with a spaced middle dot', () => {
    expect(CLAUDE_FOOTER_PADDING_VERTICAL).toBe(16)
    expect(CLAUDE_FOOTER_IDLE_MIN_WIDTH).toBe(48)
    expect(CLAUDE_FOOTER_SEPARATOR).toBe(' · ')
  })
})
