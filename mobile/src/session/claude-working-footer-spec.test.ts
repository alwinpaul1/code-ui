import { describe, expect, it } from 'vitest'
import {
  CLAUDE_FOOTER_IDLE_MIN_WIDTH,
  CLAUDE_FOOTER_PADDING_VERTICAL,
  CLAUDE_FOOTER_SEPARATOR,
  CLAUDE_SPINNER,
  CLAUDE_WORKING_VERBS,
  nextSpinnerFrame,
  randomVerbIndex,
  verbChangeDelayMs
} from './claude-working-footer-spec'

// Values from com.anthropic.claude 1.261009.20 (nl7.java, l8.java, zn.java; see the spec file).
describe("the Claude app's working footer, pinned to the decompiled numbers", () => {
  it('runs an 84-frame, 16 dp spinner at 60 ms a frame and rests on frame 4', () => {
    expect(CLAUDE_SPINNER).toEqual({ frames: 84, frameMs: 60, restFrame: 4, size: 16, gapWorking: 8 })
  })

  it('wraps the frame at the end of the sprite and not before', () => {
    expect(nextSpinnerFrame(0)).toBe(1)
    expect(nextSpinnerFrame(82)).toBe(83)
    expect(nextSpinnerFrame(83)).toBe(0)
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
