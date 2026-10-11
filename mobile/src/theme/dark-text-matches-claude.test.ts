import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { darkColors } from './tokens'

// Reported 2026-10-11 with screenshots of the same chat side by side: "the
// writings in Claude are too like white and easy to read". Sampled from those
// screenshots, the Claude app draws dark-mode body text at (248, 248, 246) on
// (21, 21, 21); Code UI drew #ECE9E2, (236, 233, 226), a warm grey, on #1A1917.
// The same day the app's own colour scheme was read from its code
// (com.anthropic.claude 1.261009.20): primary text #F9F9F7 on #151515. The
// screenshot's (248, 248, 246) was that, less one step of anti-aliasing.
describe('dark mode text', () => {
  it("is the Claude app's primary text, in the chat and in the user's card", () => {
    expect(darkColors.text).toBe('#F9F9F7')
    expect(darkColors.userBubbleText).toBe('#F9F9F7')
  })

  it('reads at least as well as before on every dark surface', () => {
    for (const surface of [darkColors.bg, darkColors.bgPanel, darkColors.bgRaised, darkColors.userBubble]) {
      expect(contrastRatio(darkColors.text, surface), surface).toBeGreaterThan(
        contrastRatio('#ECE9E2', surface)
      )
    }
  })
})
