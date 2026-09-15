import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// Host terminal beside the phone, 2026-09-15: the prompt carried five images and
// the phone showed no sign of any of them — not the picture (it has no bytes for
// one pasted on the desktop) and not the "Image on Desktop" placeholder either.
// The message read as though nothing had been attached.
//
// The screen parser DELETED the markers. The desktop-beacon path learned this
// lesson already: keep the raw text, marker and all, because
// normalizeNativeChatUserText removes `[Image #N]` from both sides when an echo
// is matched to its transcript row, so the keys agree either way — and the
// placeholder is applied where the bubble is drawn, which needs the marker to
// still be there.
describe('a prompt that carried images', () => {
  it('keeps the markers, so the bubble can say an image was sent', () => {
    const [prompt = ''] = sentPromptsFromScreen([
      '❯ [Image #179] so where is this slider in the charging scheduler',
      '  ⎿ [Image #179]',
      '',
      '❯ '
    ])
    expect(prompt).toContain('[Image #179]')
    expect(prompt).toContain('so where is this slider')
  })

  it('keeps every marker in a prompt that carried several', () => {
    const [prompt = ''] = sentPromptsFromScreen([
      "❯ fix that[Image #180] [Image #181] it's not showing",
      '',
      '❯ '
    ])
    expect(prompt).toContain('[Image #180]')
    expect(prompt).toContain('[Image #181]')
  })

  it('keeps a marker that opens a later paragraph', () => {
    const [prompt = ''] = sentPromptsFromScreen([
      '❯ first paragraph',
      '',
      '  [Image #185] also have a search bar for this',
      '  ⎿ [Image #185]',
      '',
      '❯ '
    ])
    expect(prompt).toContain('[Image #185]')
    expect(prompt).toContain('also have a search bar for this')
  })

  it('leaves a prompt with no images exactly as it was', () => {
    expect(sentPromptsFromScreen(['❯ just words', '', '❯ '])).toEqual(['just words'])
  })

  it('does not turn a bare marker into an empty message', () => {
    // A prompt that is ONLY an image still has something to draw.
    const [prompt = ''] = sentPromptsFromScreen(['❯ [Image #9]', '  ⎿ [Image #9]', '', '❯ '])
    expect(prompt).toBe('[Image #9]')
  })
})
