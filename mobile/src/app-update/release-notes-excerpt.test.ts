import { describe, expect, it } from 'vitest'

import { releaseNotesExcerpt } from './release-notes-excerpt'

describe('releaseNotesExcerpt', () => {
  it('turns a generated GitHub release body into plain bullet text', () => {
    const body = [
      '## What\'s Changed',
      '* Chat permission card: Allow / Allow all / Deny by @alwinpaul1 in https://github.com/alwinpaul1/code-ui/pull/3',
      '* Relay: dial sooner when direct is dead by @alwinpaul1 in https://github.com/alwinpaul1/code-ui/pull/4',
      '',
      '**Full Changelog**: https://github.com/alwinpaul1/code-ui/compare/a...b'
    ].join('\n')
    expect(releaseNotesExcerpt(body)).toEqual([
      'Chat permission card: Allow / Allow all / Deny',
      'Relay: dial sooner when direct is dead'
    ])
  })

  it('caps at four lines and strips markdown emphasis and links', () => {
    const body = ['- **one** [docs](https://x)', '- two', '- three', '- four', '- five'].join('\n')
    expect(releaseNotesExcerpt(body)).toEqual(['one docs', 'two', 'three', 'four'])
  })

  it('returns nothing for an empty body', () => {
    expect(releaseNotesExcerpt(null)).toEqual([])
    expect(releaseNotesExcerpt('')).toEqual([])
  })
})

// 2026-09-12: the 0.5.12 banner read "• Release 0.5.12 • Delete a leftover
// update APK on an idle launch". The first line is the version-bump commit,
// which says nothing a person can act on; the card already shows the version.
describe('release notes excerpt hides the version-bump line', () => {
  it('drops "Release x.y.z" and keeps the real changes', () => {
    expect(
      releaseNotesExcerpt(
        "## What's changed\n\n- Release 0.5.12\n- Delete a leftover update APK on an idle launch\n\n**Full Changelog**: https://x/compare/a...b"
      )
    ).toEqual(['Delete a leftover update APK on an idle launch'])
  })

  it('shows nothing rather than the bump line when a release carries no other change', () => {
    expect(releaseNotesExcerpt('- Release 0.5.9')).toEqual([])
  })
})
