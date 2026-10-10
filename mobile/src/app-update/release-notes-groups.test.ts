import { describe, expect, it } from 'vitest'

import { hasReleaseNoteSections, releaseNoteGroups } from './release-notes-groups'

// The card draws a release's notes as one group per section, each under its
// marker (2026-10-10). These pin how a body becomes groups, including the
// bodies that predate the section format and must draw as they always did.

describe('a notes body in the section format', () => {
  it('becomes one group per section, in order, with the titles taken out of the words', () => {
    const groups = releaseNoteGroups(
      ['### Features', '- A', '', '### Improvements', '- B', '', '### Security & Bug Fixes', '- C'].join('\n')
    )
    expect(groups).toEqual([
      { section: 'Features', markdown: '- A' },
      { section: 'Improvements', markdown: '- B' },
      { section: 'Security & Bug Fixes', markdown: '- C' }
    ])
    expect(hasReleaseNoteSections(groups)).toBe(true)
  })

  it('reads a single section, the shape most patch releases have', () => {
    expect(releaseNoteGroups('### Security & Bug Fixes\n- Sleep display is back')).toEqual([
      { section: 'Security & Bug Fixes', markdown: '- Sleep display is back' }
    ])
  })

  it('moves the Full Changelog line out of the last section into a group of its own', () => {
    const groups = releaseNoteGroups(
      '### Features\n- A\n\n**Full Changelog**: https://github.com/o/r/compare/a...b\r\n'
    )
    expect(groups).toEqual([
      { section: 'Features', markdown: '- A' },
      { section: null, markdown: '[Full changelog](https://github.com/o/r/compare/a...b)' }
    ])
  })

  it('keeps text above the first section as an untitled group in front', () => {
    expect(releaseNoteGroups('A short intro.\n\n### Features\n- A')).toEqual([
      { section: null, markdown: 'A short intro.' },
      { section: 'Features', markdown: '- A' }
    ])
  })

  it('leaves out a section with nothing under it', () => {
    expect(releaseNoteGroups('### Features\n\n### Improvements\n- B')).toEqual([
      { section: 'Improvements', markdown: '- B' }
    ])
  })

  it('does not take a section title inside a code fence for a real one', () => {
    const groups = releaseNoteGroups('### Features\n- A\n```\n### Improvements\n```')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.section).toBe('Features')
    expect(groups[0]!.markdown).toContain('### Improvements')
  })
})

// Review of a997d5e4a: the splitter matched titles on raw lines, without the
// comment, fence and indented-code rules the reshaper applies, so a hidden
// draft drew as a section and a change moved into the wrong one.
describe('a section title the reshaper would not treat as one', () => {
  it('inside an HTML comment stays hidden, and the change after it stays in its section', () => {
    expect(releaseNoteGroups('### Features\n- a\n<!--\n### Improvements\nhidden draft\n-->\n- b')).toEqual([
      { section: 'Features', markdown: '- a\n- b' }
    ])
  })

  it('inside a fence that a ```js line does not close is code, not a section', () => {
    const groups = releaseNoteGroups('### Features\n```\nx\n```js\n### Improvements\ny\n```\n- b')
    expect(groups.map((group) => group.section)).toEqual(['Features'])
    expect(groups[0]!.markdown).toContain('### Improvements')
    expect(groups[0]!.markdown.endsWith('- b')).toBe(true)
  })

  it('on an indented code line is code, not a section', () => {
    const groups = releaseNoteGroups('### Features\n- a\n\n    ### Improvements')
    expect(groups.map((group) => group.section)).toEqual(['Features'])
    expect(groups[0]!.markdown).toContain('    ### Improvements')
  })
})

describe('a body that is not in the section format', () => {
  it("is one untitled group, reshaped as before: GitHub's generated list", () => {
    const groups = releaseNoteGroups("## What's changed\r\n\r\n- One\r\n- Two")
    expect(groups).toEqual([{ section: null, markdown: "**What's changed**\n\n- One\n- Two" }])
    expect(hasReleaseNoteSections(groups)).toBe(false)
  })

  it('treats an unknown heading as words, not as a section', () => {
    expect(hasReleaseNoteSections(releaseNoteGroups('### Highlights\n- A'))).toBe(false)
  })

  it('is no groups at all when there are no notes', () => {
    expect(releaseNoteGroups(null)).toEqual([])
    expect(releaseNoteGroups('')).toEqual([])
    expect(releaseNoteGroups('   \n  ')).toEqual([])
  })
})
