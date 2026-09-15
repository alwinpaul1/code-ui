import { describe, expect, it } from 'vitest'
import { showDesktopPromptImages } from './mobile-desktop-prompt-images'

// 2026-09-15 from the phone: "see this message on host shows an image, see the
// same message on phone — my screen doesn't show that image was there." The
// marker was stripped outright because the phone has no bytes for a
// desktop-pasted image, so the prompt arrived reading as if nothing had been
// attached at all.
describe('a desktop-pasted image in a prompt the phone draws', () => {
  it('leaves a sign that an image was sent', () => {
    expect(showDesktopPromptImages('see this [Image #1]')).toBe('see this 🖼 Image')
  })

  it('marks every image in a prompt that carried several', () => {
    expect(showDesktopPromptImages('[Image #1] and [Image #2] here')).toBe(
      '🖼 Image and 🖼 Image here'
    )
  })

  it('leaves a prompt with no image exactly as written', () => {
    expect(showDesktopPromptImages('no picture here')).toBe('no picture here')
  })

  // Only the agent's own marker shape; ordinary brackets are the user's words.
  it('does not touch text that merely mentions an image', () => {
    expect(showDesktopPromptImages('[Image] and [see #1]')).toBe('[Image] and [see #1]')
  })
})
