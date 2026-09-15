import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// Reported 2026-09-15 with a screenshot: a bubble reading "push" followed by
// two rows of box-drawing rules. The agent had printed a framed panel under the
// prompt, and the parser read its borders as more of the message.
//
// The exclusion list carried a few box glyphs it had been bitten by — │ ├ ╰ ╭ └
// — one at a time. The block they come from is U+2500..U+257F entire, plus the
// block elements above it, and NONE of them can start a line a person typed.
describe('a framed panel printed under a prompt', () => {
  it('does not glue the frame onto the message', () => {
    const prompts = sentPromptsFromScreen([
      '❯ push',
      '  ┌───────────────┬──────────┐',
      '  │ branch        │ status   │',
      '  ├───────────────┼──────────┤',
      '  └───────────────┴──────────┘',
      '',
      '❯ '
    ])
    expect(prompts).toEqual(['push'])
  })

  it('refuses every glyph in the box-drawing block, not the handful seen so far', () => {
    for (const glyph of ['─', '┌', '┐', '┘', '┬', '┴', '┼', '┤', '━', '┏', '┓', '┗', '┛', '▀', '█']) {
      expect(sentPromptsFromScreen(['❯ push', `  ${glyph} something`, '', '❯ '])).toEqual([
        'push'
      ])
    }
  })

  it('still gathers an ordinary wrapped line', () => {
    expect(
      sentPromptsFromScreen(['❯ push the branch', '  and open a PR', '', '❯ '])
    ).toEqual(['push the branch and open a PR'])
  })

  it('keeps a dash the user actually typed', () => {
    // An em dash or a hyphen opens plenty of real sentences and bullet lines.
    expect(sentPromptsFromScreen(['❯ do it', '  - first thing', '', '❯ '])).toEqual([
      'do it - first thing'
    ])
    expect(sentPromptsFromScreen(['❯ do it', '  — first thing', '', '❯ '])).toEqual([
      'do it — first thing'
    ])
  })
})
