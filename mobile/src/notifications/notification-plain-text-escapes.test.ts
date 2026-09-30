import { describe, expect, it } from 'vitest'
import { notificationPlainText, styleText } from './notification-plain-text'

const mono = (text: string) => styleText(text, 'mono')
const bold = (text: string) => styleText(text, 'bold')
const italic = (text: string) => styleText(text, 'italic')

// The chat draws and copies a backslash escape as the mark it escapes
// (markdown-inline-escapes.ts, 38e30805), as CommonMark reads it. The shade
// never got that rule: it kept each backslash and read the escaped stars as
// emphasis, so `Use \*args and \*\*kwargs here` read "Use \𝘢𝘳𝘨𝘴 𝘢𝘯𝘥 \\*kwargs
// here" in the notification and "Use *args and **kwargs here" in the chat
// (review, 2026-09-30).
describe('an escaped Markdown mark in the shade', () => {
  it('reads an escaped star as a star, not as emphasis', () => {
    expect(notificationPlainText('Use \\*args and \\*\\*kwargs here')).toBe(
      'Use *args and **kwargs here'
    )
    expect(notificationPlainText('literal \\*not\\* emphasis')).toBe('literal *not* emphasis')
  })

  it('reads escaped underscores and tildes as themselves', () => {
    expect(notificationPlainText('\\_not italic\\_')).toBe('_not italic_')
    expect(notificationPlainText('\\~~not struck~~')).toBe('~~not struck~~')
  })

  it('reads an escaped bracket as no link, and an escaped backtick as no code', () => {
    expect(notificationPlainText('\\[a\\](b)')).toBe('[a](b)')
    expect(notificationPlainText('\\`not code`')).toBe('`not code`')
  })

  it('reads an escape inside emphasis and inside the words of a link', () => {
    expect(notificationPlainText('**a\\*b**')).toBe(`${bold('a')}*${bold('b')}`)
    expect(notificationPlainText('[a\\*b](https://x.dev)')).toBe('a*b')
  })

  it('reads two backslashes as one, which escapes nothing after it', () => {
    expect(notificationPlainText('two \\\\ backslashes')).toBe('two \\ backslashes')
    expect(notificationPlainText('a \\\\*b*')).toBe(`a \\${italic('b')}`)
  })

  it('keeps a backslash before a letter, and a lone or trailing one', () => {
    expect(notificationPlainText('C:\\Users\\x')).toBe('C:\\Users\\x')
    expect(notificationPlainText('\\')).toBe('\\')
    expect(notificationPlainText('ends in \\')).toBe('ends in \\')
  })

  it('keeps the backslashes inside a code span', () => {
    expect(notificationPlainText('code `a\\*b` stays')).toBe(`code ${mono('a\\*b')} stays`)
    expect(notificationPlainText('`\\\\` and \\*')).toBe(`${mono('\\\\')} and *`)
  })
})
