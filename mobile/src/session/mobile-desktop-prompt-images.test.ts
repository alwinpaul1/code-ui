import { describe, expect, it } from 'vitest'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import { showDesktopPromptImages } from './mobile-desktop-prompt-images'

// 2026-09-15 from the phone: "see this message on host shows an image, see the
// same message on phone — my screen doesn't show that image was there." The
// marker was stripped outright because the phone has no bytes for a
// desktop-pasted image, so the prompt arrived reading as if nothing had been
// attached at all.
describe('a desktop-pasted image in a prompt the phone draws', () => {
  // Same wording the image chip already uses for a picture that lives on the
  // desktop, so the two do not describe the same thing two ways.
  it('leaves a sign that an image was sent, worded as the chip words it', () => {
    expect(showDesktopPromptImages('see this [Image #1]')).toBe('see this Image on Desktop')
  })

  it('marks every image in a prompt that carried several', () => {
    expect(showDesktopPromptImages('[Image #1] and [Image #2] here')).toBe(
      'Image on Desktop and Image on Desktop here'
    )
  })

  it('leaves a prompt with no image exactly as written', () => {
    expect(showDesktopPromptImages('no picture here')).toBe('no picture here')
  })

  // Only the agent's own marker shape; ordinary brackets are the user's words.
  it('does not touch text that merely mentions an image', () => {
    expect(showDesktopPromptImages('[Image] and [see #1]')).toBe('[Image] and [see #1]')
  })

  // 2026-09-15, caught by a regression audit an hour after the placeholder
  // shipped: an optimistic bubble is retired by matching its NORMALIZED text
  // against the transcript row's, and normalization DELETES `[Image #N]`.
  // That deletion is exactly why the old stripped text matched. A placeholder
  // that survives normalization makes the two keys diverge, so the echo can
  // never retire and the message draws twice, for good. Whatever the phone
  // SHOWS, the text it matches on has to normalize to the row's.
  it('is applied only where the bubble is DRAWN, never to the matching key', () => {
    const row = 'look at this [Image #1] and tell me'
    // The echo keeps the raw marker, so its key still normalizes onto the
    // transcript row's and the bubble can retire.
    expect(normalizeReconcileText(row)).toBe('look at this and tell me')
    // And the placeholder is what the reader sees.
    expect(showDesktopPromptImages(row)).toBe('look at this Image on Desktop and tell me')
  })
})
