import { describe, expect, it } from 'vitest'
import { notificationPlainText, styleText } from './notification-plain-text'

// Seen on the Galaxy S23 (2026-09-09): Claude's turn summary arrives as
// Markdown and Android showed the raw asterisks and backticks in the shade.
// The user wants the emphasis kept, not dropped, so it rides on Unicode
// letterforms — the only styling a plain notification string can carry.
describe('notification text keeps its emphasis without Markdown markers', () => {
  it('renders bold, italic and code as styled letterforms and links as their text', () => {
    expect(
      notificationPlainText('**Done** — fixed `parseQueue` in *two* files, see [the diff](https://x.y/z)')
    ).toBe(
      `${styleText('Done', 'bold')} — fixed ${styleText('parseQueue', 'mono')} in ${styleText('two', 'italic')} files, see the diff`
    )
    expect(styleText('Done', 'bold')).toBe('𝗗𝗼𝗻𝗲')
    expect(styleText('two', 'italic')).toBe('𝘵𝘸𝘰')
    expect(styleText('parseQueue', 'mono')).toBe('𝚙𝚊𝚛𝚜𝚎𝚀𝚞𝚎𝚞𝚎')
  })

  it('turns headings bold, list markers into bullets, and drops fences', () => {
    expect(
      notificationPlainText(
        '## Summary\n\n* Added the test\n- Fixed the bug\n\n```ts\nconst a = 1\n```\n\n1. next step'
      )
    ).toBe(`${styleText('Summary', 'bold')}\n\n• Added the test\n• Fixed the bug\n\nconst a = 1\n\n1. next step`)
  })

  it('leaves ordinary punctuation, digits in prose, and non-ASCII alone', () => {
    expect(notificationPlainText('Claude finished.')).toBe('Claude finished.')
    expect(notificationPlainText('2 * 3 = 6 and snake_case_name stays')).toBe(
      '2 * 3 = 6 and snake_case_name stays'
    )
    expect(styleText('Ärger 42!', 'bold')).toBe('Ä𝗿𝗴𝗲𝗿 𝟰𝟮!')
  })

  it('collapses runs of blank lines', () => {
    expect(notificationPlainText('a\n\n\n\nb')).toBe('a\n\nb')
  })
})
