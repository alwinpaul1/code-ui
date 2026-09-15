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

  it('leaves a prompt with no images exactly as it was', () => {
    expect(sentPromptsFromScreen(['❯ just words', '', '❯ '])).toEqual(['just words'])
  })

  it('does not turn a bare marker into an empty message', () => {
    // A prompt that is ONLY an image still has something to draw.
    const [prompt = ''] = sentPromptsFromScreen(['❯ [Image #9]', '  ⎿ [Image #9]', '', '❯ '])
    expect(prompt).toBe('[Image #9]')
  })
})

// REMOVED 2026-09-15, with the continuation gathering they pinned:
//
//   keeps a marker that opens a later paragraph
//
// The reader takes the `❯` row and nothing under it. Those rows are shaped
// exactly like the agent's own prose — two spaces, then words — and nothing
// visible tells them apart, which is how replies ended up inside user bubbles.
// A wrapped prompt now comes back as its first row, a prefix of the real
// message, and retirement gives way to the transcript row when it lands.
// The contract is pinned in mobile-terminal-single-row-prompts.test.ts.
