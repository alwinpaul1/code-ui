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
