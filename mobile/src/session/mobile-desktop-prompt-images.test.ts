import { describe, expect, it } from 'vitest'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import {
  DESKTOP_PROMPT_IMAGE_REF,
  desktopPromptImageBlocks,
  isDesktopImageRef
} from './mobile-desktop-prompt-images'

// 2026-09-15 from the phone: "see this message on host shows an image, see the
// same message on phone — my screen doesn't show that image was there." The
// marker was stripped outright because the phone has no bytes for a
// desktop-pasted image, so the prompt arrived reading as if nothing had been
// attached at all.
//
// 2026-09-19, device: the sign was the words "Image on Desktop" spliced INTO
// the sentence ("see this Image on Desktop i already send…"), while a send
// from the phone draws its pictures as chips above the caption. Same message,
// two layouts. The marker now becomes an image block the chip renderer draws,
// and a local preview the phone happens to hold fills that block with the
// picture itself.
describe('a desktop-pasted image in a prompt the phone draws', () => {
  it('becomes an image chip above the caption, not words inside it', () => {
    expect(desktopPromptImageBlocks('see this [Image #1] i already send')).toEqual([
      { type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF },
      { type: 'text', text: 'see this i already send' }
    ])
  })

  it('draws one chip per image in a prompt that carried several', () => {
    expect(desktopPromptImageBlocks('[Image #1] and [Image #2] here')).toEqual([
      { type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF },
      { type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF },
      { type: 'text', text: 'and here' }
    ])
  })

  it('draws a marker-only prompt as chips with no empty caption under them', () => {
    expect(desktopPromptImageBlocks('[Image #3]')).toEqual([
      { type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF }
    ])
  })

  it('leaves a prompt with no image as one text block, exactly as written', () => {
    expect(desktopPromptImageBlocks('no picture here')).toEqual([
      { type: 'text', text: 'no picture here' }
    ])
  })

  // Only the agent's own marker shape; ordinary brackets are the user's words.
  it('does not touch text that merely mentions an image', () => {
    expect(desktopPromptImageBlocks('[Image] and [see #1]')).toEqual([
      { type: 'text', text: '[Image] and [see #1]' }
    ])
  })

  it('is the chip renderer’s desktop case, beside a desktop clipboard path', () => {
    expect(isDesktopImageRef({ type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF })).toBe(true)
    expect(
      isDesktopImageRef({
        type: 'image-ref',
        path: '/var/folders/0y/session/T/orca-paste-1788732989689-c9b48721-60fe-4649-9ee3-a1369133656b.png'
      })
    ).toBe(true)
    // A preview the phone holds wins: that block is a picture, not a chip.
    expect(
      isDesktopImageRef({ type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF, url: 'file:///p.jpg' })
    ).toBe(false)
    expect(isDesktopImageRef({ type: 'image-ref', path: '/tmp/host.png' })).toBe(false)
  })

  // 2026-09-15, caught by a regression audit an hour after the placeholder
  // shipped: an optimistic bubble is retired by matching its NORMALIZED text
  // against the transcript row's, and normalization DELETES `[Image #N]`.
  // Whatever the phone SHOWS, the text it matches on has to normalize to the
  // row's, so the blocks are built where the bubble is DRAWN and the echo
  // keeps its raw marker for the matching key.
  it('is applied only where the bubble is DRAWN, never to the matching key', () => {
    const row = 'look at this [Image #1] and tell me'
    expect(normalizeReconcileText(row)).toBe('look at this and tell me')
    expect(desktopPromptImageBlocks(row).at(-1)).toEqual({
      type: 'text',
      text: 'look at this and tell me'
    })
  })
})
