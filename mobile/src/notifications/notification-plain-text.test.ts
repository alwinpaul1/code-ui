import { describe, expect, it } from 'vitest'
import { notificationPlainText } from './notification-plain-text'

// Seen on the Galaxy S23 (2026-09-09): Claude's turn summary arrives as
// Markdown and Android showed the raw asterisks and backticks in the shade.
describe('notification text loses its Markdown markers', () => {
  it('strips bold, italic, inline code and links but keeps the words', () => {
    expect(notificationPlainText('**Done** — fixed `parseQueue` in *two* files, see [the diff](https://x.y/z)')).toBe(
      'Done — fixed parseQueue in two files, see the diff'
    )
  })

  it('turns list markers into bullets and drops headings and fences', () => {
    expect(
      notificationPlainText('## Summary\n\n* Added the test\n- Fixed the bug\n\n```ts\nconst a = 1\n```\n\n1. next step')
    ).toBe('Summary\n\n• Added the test\n• Fixed the bug\n\nconst a = 1\n\n1. next step')
  })

  it('leaves ordinary punctuation alone', () => {
    expect(notificationPlainText('Claude finished.')).toBe('Claude finished.')
    expect(notificationPlainText('2 * 3 = 6 and snake_case_name stays')).toBe('2 * 3 = 6 and snake_case_name stays')
  })

  it('collapses runs of blank lines', () => {
    expect(notificationPlainText('a\n\n\n\nb')).toBe('a\n\nb')
  })
})
