import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// Real rows, host terminal screenshot 2026-09-15 (Claude Code 2.1.270). One
// prompt, three paragraphs, with the images it carried listed underneath as
// `⎿` attachment rows. The phone showed the first two paragraphs and silently
// dropped the third.
//
// `isToolRow` treats "the next row starts with ⎿" as proof that THIS row is a
// running tool. That is true of a tool row, whose ⎿ carries command output. It
// is also true of the LAST paragraph of any prompt that carried an image,
// because Claude prints the attachment rows directly under the prompt — so the
// parser broke there and the paragraph went with it.
const SCREEN = [
  '❯ [Image #179] so where is this slider in the charging of scheduler for seven day thing so earlier it was there and right now',
  "  what happened uh, so the numbers doesn't uh, seem inside the graph uh, fix that[Image #180] [Image #181] it's not showing",
  '  uh, from what percentage to what percentage did it charge uh, like that also have some icons uh, to show it nicely when',
  "  it's hovered um, so it looks better in UI UX way um,",
  '',
  '  [Image #183] see there is no this slider [Image #184] in 7day view and the text is completely outside',
  '',
  '  [Image #185] also have a search bar for this',
  '  ⎿ [Image #183]',
  '  ⎿ [Image #184]',
  '  ⎿ [Image #185]',
  '',
  '  All gates green (4633 pass, build clean, four colour classes in the CSS).',
  '',
  '❯ '
]

describe('a prompt whose images are listed under it', () => {
  it('keeps the paragraph the attachment rows sit beneath', () => {
    const [prompt = ''] = sentPromptsFromScreen(SCREEN)
    expect(prompt).toContain('also have a search bar for this')
  })

  it('keeps the paragraphs above it too', () => {
    const [prompt = ''] = sentPromptsFromScreen(SCREEN)
    expect(prompt).toContain('so where is this slider')
    expect(prompt).toContain('the text is completely outside')
  })

  it('still stops before the agent’s reply', () => {
    const [prompt = ''] = sentPromptsFromScreen(SCREEN)
    expect(prompt).not.toContain('All gates green')
  })

  it('still refuses a genuine tool row, whose ⎿ carries output', () => {
    const prompts = sentPromptsFromScreen([
      '❯ run the tests',
      '  Running the suite',
      '  ⎿  $ npx vitest run',
      '',
      '❯ '
    ])
    expect(prompts).toEqual(['run the tests'])
  })

  it('reads a single-paragraph prompt with one image, marker kept', () => {
    expect(
      sentPromptsFromScreen(['❯ [Image #1] look at this', '  ⎿ [Image #1]', '', '❯ '])
    ).toEqual(['[Image #1] look at this'])
  })
})
