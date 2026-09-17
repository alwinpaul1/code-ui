import { describe, expect, it } from 'vitest'

import { releaseNotesMarkdown } from './release-notes-markdown'

// What the card shows is the release body AS MARKDOWN, not a plain-text
// excerpt of it: bullets stay bullets, bold stays bold, a link stays tappable.
// The body is reshaped for a 270-wide alert card, nothing more.

/** GitHub's API body for mobile-android-v0.6.4, CRLF line endings included. */
const RELEASE_0_6_4 = [
  "## What's changed",
  '',
  '- Release 0.6.4: messages stay where they happened',
  '- Draw a send where it happened, even when its boundary must stay withheld',
  '- Close the two untested gaps the echo audit named',
  '',
  '**Full Changelog**: https://github.com/alwinpaul1/code-ui/compare/mobile-android-v0.6.3...mobile-android-v0.6.4',
  ''
].join('\r\n')

describe('a generated GitHub release body, reshaped for a 270 card', () => {
  it('keeps the bullets as markdown and turns the section heading into a bold line', () => {
    expect(releaseNotesMarkdown(RELEASE_0_6_4)).toBe(
      [
        "**What's changed**",
        '',
        '- Release 0.6.4: messages stay where they happened',
        '- Draw a send where it happened, even when its boundary must stay withheld',
        '- Close the two untested gaps the echo audit named',
        '',
        '[Full changelog](https://github.com/alwinpaul1/code-ui/compare/mobile-android-v0.6.3...mobile-android-v0.6.4)'
      ].join('\n')
    )
  })

  it('drops the "by @user in <PR url>" tail GitHub appends to a merged PR line', () => {
    const body = [
      "## What's Changed",
      '* Chat permission card: Allow / Allow all / Deny by @alwinpaul1 in https://github.com/alwinpaul1/code-ui/pull/3',
      '* Relay: dial sooner when direct is dead by @alwinpaul1 in https://github.com/alwinpaul1/code-ui/pull/4'
    ].join('\n')
    expect(releaseNotesMarkdown(body)).toBe(
      [
        "**What's Changed**",
        '* Chat permission card: Allow / Allow all / Deny',
        '* Relay: dial sooner when direct is dead'
      ].join('\n')
    )
  })

  it('leaves emphasis, code and links inside a bullet alone', () => {
    expect(releaseNotesMarkdown('- **Bold** `code` [docs](https://x/y)')).toBe(
      '- **Bold** `code` [docs](https://x/y)'
    )
  })

  // 2026-09-12: the 0.5.12 banner read "• Release 0.5.12 • Delete a leftover
  // update APK on an idle launch". A bare bump line says nothing the card's own
  // version line does not; one that carries a summary after the colon does.
  it('drops a bare "Release x.y.z" bump line and keeps one that says what changed', () => {
    expect(releaseNotesMarkdown('- Release 0.5.12\n- Delete a leftover update APK')).toBe(
      '- Delete a leftover update APK'
    )
    expect(releaseNotesMarkdown('- Release 0.6.4: messages stay where they happened')).toBe(
      '- Release 0.6.4: messages stay where they happened'
    )
  })

  it('drops an HTML comment GitHub leaves in a hand-edited body', () => {
    expect(releaseNotesMarkdown('<!-- Release notes generated using configure-releases -->\n- One')).toBe(
      '- One'
    )
  })

  it('keeps a body with no heading and no changelog line as it is', () => {
    expect(releaseNotesMarkdown('- One fix\n- Two fix')).toBe('- One fix\n- Two fix')
  })

  it('shows nothing rather than the bump line when a release carries no other change', () => {
    expect(releaseNotesMarkdown('- Release 0.5.9')).toBe('')
  })

  it('returns an empty string for an empty or missing body', () => {
    expect(releaseNotesMarkdown(null)).toBe('')
    expect(releaseNotesMarkdown(undefined)).toBe('')
    expect(releaseNotesMarkdown('')).toBe('')
    expect(releaseNotesMarkdown('   \n\n  ')).toBe('')
  })

  it('collapses the blank lines a dropped line leaves behind', () => {
    expect(releaseNotesMarkdown('## H\n\n\n\n- One\n\n\n**Full Changelog**: https://x')).toBe(
      '**H**\n\n- One\n\n[Full changelog](https://x)'
    )
  })
})

// A reviewer fed the transform a hand-edited body with a fenced block in it
// (2026-09-17) and it rewrote the code: a "## not a heading" inside the fence
// came out bold, a "by @x in <url>" inside it lost its tail, and a
// "- Release 1.2.3" inside it was DELETED, leaving an empty fence. A reader
// cannot see a deleted line. Nothing inside a code block is prose.
describe('a code block in the release body', () => {
  const FENCED = [
    '- One fix',
    '',
    '```sh',
    '## not a heading',
    'const a = 1 by @x in https://y/z',
    '- Release 1.2.3',
    '<!-- not a comment -->',
    '```',
    '',
    '- Two fix'
  ].join('\n')

  it('passes through a fenced block untouched, every line of it', () => {
    expect(releaseNotesMarkdown(FENCED)).toBe(FENCED)
  })

  it('treats ~~~ as a fence too, and does not close ``` with ~~~ or a shorter run', () => {
    const tilde = ['~~~', '## kept', '```', '## still inside', '~~~', '## heading'].join('\n')
    expect(releaseNotesMarkdown(tilde)).toBe(
      ['~~~', '## kept', '```', '## still inside', '~~~', '**heading**'].join('\n')
    )
    const longer = ['````', '```', '## inside', '````', '## heading'].join('\n')
    expect(releaseNotesMarkdown(longer)).toBe(
      ['````', '```', '## inside', '````', '**heading**'].join('\n')
    )
  })

  it('leaves a fence that never closes alone to the end of the body', () => {
    const open = ['## title', '```', '- Release 1.2.3', '## inside'].join('\n')
    expect(releaseNotesMarkdown(open)).toBe(['**title**', '```', '- Release 1.2.3', '## inside'].join('\n'))
  })

  it('keeps a fence that sits inside a list item', () => {
    const nested = ['- Run it:', '  ```', '  - Release 9.9.9', '  ```', '- Release 1.2.3'].join('\n')
    expect(releaseNotesMarkdown(nested)).toBe(['- Run it:', '  ```', '  - Release 9.9.9', '  ```'].join('\n'))
  })

  it('passes through an indented code block untouched', () => {
    const indented = ['Run:', '', '    ## not a heading', '    - Release 1.2.3', '\t- fix by @x in https://y'].join('\n')
    expect(releaseNotesMarkdown(indented)).toBe(indented)
  })

  it('still strips an HTML comment outside a fence, even one spanning lines', () => {
    expect(releaseNotesMarkdown('<!-- a\nb -->\n- One\n```\n<!-- keep -->\n```')).toBe(
      '- One\n```\n<!-- keep -->\n```'
    )
  })
})

// The four other rules the same review found wrong (2026-09-17).
describe('the transform against bodies GitHub does not generate', () => {
  it('drops a bare "Release x.y.z" line whether or not it is bulleted, as the excerpt did', () => {
    expect(releaseNotesMarkdown('Release 0.6.4')).toBe('')
    expect(releaseNotesMarkdown('Release 0.6.4\n- Fix')).toBe('- Fix')
    expect(releaseNotesMarkdown('1. Release 0.6.4\n2. Fix')).toBe('2. Fix')
  })

  it('drops the "by @user in" tail whatever the last token is, as the excerpt did', () => {
    expect(releaseNotesMarkdown('- Fix by @alwinpaul1 in #3')).toBe('- Fix')
    expect(releaseNotesMarkdown('- Fix by @alwinpaul1 in https://x/pull/3')).toBe('- Fix')
    // Not a tail: "in" mid-sentence.
    expect(releaseNotesMarkdown('- Fix by @alwinpaul1 in the relay, then more')).toBe(
      '- Fix by @alwinpaul1 in the relay, then more'
    )
  })

  it('bolds a heading that already carries emphasis without nesting the markers', () => {
    expect(releaseNotesMarkdown('## **Bold** and `code`')).toBe('**Bold and `code`**')
    expect(releaseNotesMarkdown('## Fix *this* now')).toBe('**Fix this now**')
    expect(releaseNotesMarkdown('## __Loud__ and _soft_')).toBe('**Loud and soft**')
    expect(releaseNotesMarkdown('## keep snake_case and [a link](https://x)')).toBe(
      '**keep snake_case and [a link](https://x)**'
    )
  })

  it('keeps sentence punctuation off the changelog link, so the link is not dead', () => {
    expect(releaseNotesMarkdown('**Full Changelog**: https://x/compare/a...b.')).toBe(
      '[Full changelog](https://x/compare/a...b).'
    )
  })

  it('leaves a changelog URL with parentheses as GitHub wrote it, which the renderer autolinks whole', () => {
    expect(releaseNotesMarkdown('**Full Changelog**: https://x/y(z)')).toBe(
      '**Full Changelog**: https://x/y(z)'
    )
  })
})
