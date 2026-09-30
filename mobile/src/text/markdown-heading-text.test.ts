import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import { releaseNotesMarkdown } from '../app-update/release-notes-markdown'
import { parseMarkdownBlocks } from '../components/pr-sidebar/markdown-blocks'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { markdownHeadingText } from './markdown-heading-text'

describe('a heading closing run of hashes', () => {
  it('comes off only when a space or tab sets it apart', () => {
    expect(markdownHeadingText('Title ##')).toBe('Title')
    expect(markdownHeadingText('Title\t#  ')).toBe('Title')
    expect(markdownHeadingText('Fix the C#')).toBe('Fix the C#')
    expect(markdownHeadingText('Fix the C# #')).toBe('Fix the C#')
  })

  it('leaves an empty heading empty and a heading with no run alone', () => {
    expect(markdownHeadingText('')).toBe('')
    expect(markdownHeadingText('#')).toBe('')
    expect(markdownHeadingText('###   ')).toBe('')
    expect(markdownHeadingText('x')).toBe('x')
    expect(markdownHeadingText('#5 is fixed')).toBe('#5 is fixed')
  })

  it('draws no "****" in the release card for a heading with no words', () => {
    expect(releaseNotesMarkdown('## ##\n- One')).toBe('- One')
  })
})

// The lazy regex that states the rule backtracked through a run of spaces
// once per character it tried (1.9 s at 40,000), and the release notes' old
// `(.+?)\s*#*\s*$` did not finish at 20,000. A PR comment body is anybody's.
// The line after it has no heading: the notification reader's trailing
// `\s+$` and the release card's "by @user in" tail rule had the same shape.
describe('a line holding a long run of spaces', () => {
  const spaces = ' '.repeat(40_000)

  it.each([
    ['the PR comment reader', parseMarkdownBlocks],
    ['the notification reader', notificationPlainText],
    ['the release card', releaseNotesMarkdown]
  ])('reads in linear time in %s', (_, read) => {
    for (const text of [`# x${spaces}y`, `x${spaces}y`]) {
      expect(() => runInNewContext('read(text)', { read, text }, { timeout: 250 }), text.slice(0, 3)).not.toThrow()
    }
  })

  it('still drops the "by @user in" tail, even on a line that is nothing else', () => {
    expect(releaseNotesMarkdown('- Fix it by @x in https://y/1')).toBe('- Fix it')
    expect(releaseNotesMarkdown('Intro\n  by @x in https://y/1')).toBe('Intro')
  })
})
