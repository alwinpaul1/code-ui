import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// Claude Code 2.1.270, 2026-09-13: the rows below are the shape the agent
// paints for prompts it has already accepted, including one the user sent
// mid-turn that never appeared in the queue box because it was absorbed
// between two tool calls.
const SCREEN = [
  '> See the followup messages in claude mobile and codeui, in codeui its',
  '  stacked and claude mobile it isnt i need it like in claude mobile',
  '',
  '  Found why they still stack: the echoes anchor to the folded row.',
  '',
  'Ran 3 shell commands',
  '',
  '> Bump the version and now release on git ci and releases and now the new',
  '  version locally with all these fixes and changes locally and on git',
  '',
  '    Locally built version install on my phone',
  '',
  'Ran 4 shell commands',
  '',
  '',
  '',
  '> Type / for commands',
  '',
  '  Opus 5'
]

describe('sentPromptsFromScreen', () => {
  it('reads a prompt the agent already took, rejoining the rows it wrapped', () => {
    const prompts = sentPromptsFromScreen(SCREEN)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toBe(
      'Bump the version and now release on git ci and releases and now the new version locally with all these fixes and changes locally and on git\nLocally built version install on my phone'
    )
  })

  it('keeps the paragraph break the user typed', () => {
    expect(sentPromptsFromScreen(SCREEN)[0]).toBe(
      'See the followup messages in claude mobile and codeui, in codeui its stacked and claude mobile it isnt i need it like in claude mobile\nFound why they still stack: the echoes anchor to the folded row.'
    )
  })

  it('never reads the live composer at the bottom of the screen', () => {
    expect(sentPromptsFromScreen(SCREEN).join(' ')).not.toContain('Type / for commands')
  })

  it('returns nothing for a screen with no prompt rows', () => {
    expect(sentPromptsFromScreen(['Ran 3 shell commands', '', 'Working…'])).toEqual([])
  })
})
