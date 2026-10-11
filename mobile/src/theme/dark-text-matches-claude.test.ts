import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { darkColors } from './tokens'

// Reported 2026-10-11 with screenshots of the same chat side by side: "the
// writings in Claude are too like white and easy to read". Sampled from those
// screenshots, the Claude app draws dark-mode body text at (248, 248, 246) on
// (21, 21, 21); Code UI drew #ECE9E2, (236, 233, 226), a warm grey, on #1A1917.
describe('dark mode text', () => {
  it("is as white as the Claude app's, in the chat and in the user's bubble", () => {
    expect(darkColors.text).toBe('#F8F8F6')
    expect(darkColors.userBubbleText).toBe('#F8F8F6')
  })

  it('reads at least as well as before on every dark surface', () => {
    for (const surface of [darkColors.bg, darkColors.bgPanel, darkColors.bgRaised, darkColors.userBubble]) {
      expect(contrastRatio(darkColors.text, surface), surface).toBeGreaterThan(
        contrastRatio('#ECE9E2', surface)
      )
    }
  })
})
