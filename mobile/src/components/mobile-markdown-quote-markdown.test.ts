import { describe, expect, it } from 'vitest'
import { markdownPlainText } from './markdown-plain-text'
import { parseMobileMarkdown, type MobileMarkdownBlock, type MobileMarkdownQuoteMember } from './mobile-markdown-parser'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import {
  QUOTED_EMAIL_COPY,
  QUOTED_EMAIL_DETAILS,
  QUOTED_EMAIL_REPLY,
  QUOTED_EMAIL_REPLY_BACKSLASH,
  QUOTED_EMAIL_REPLY_TWO_SPACES,
  QUOTED_EMAIL_SIGN_OFF
} from './mobile-markdown-quote-email.test-support'
import { NATIVE_PROSE_LIST_INDENT, buildNativeProseModel } from './native-prose-model'
import { nativeChatReplyPlainText } from '../session/mobile-native-chat-message-text'

// The email draft quoted in a reply (mobile-markdown-quote-email.test-support.ts):
// the Claude app draws a quote's insides as Markdown, and so must the phone.

type Quote = Extract<MobileMarkdownBlock, { type: 'quote' }>

function onlyQuote(source: string): Quote {
  const quotes = parseMobileMarkdown(source).filter((block): block is Quote => block.type === 'quote')
  expect(quotes).toHaveLength(1)
  return quotes[0]!
}

const bullet = (text: string) => ({ text, depth: 0, ordered: false, checked: undefined, number: undefined, continuation: undefined })

const EXPECTED_MEMBERS = [
  { type: 'paragraph', text: 'Dear Sam,' },
  {
    type: 'paragraph',
    text: 'I hope you are well. I am a nurse on board MV Example, and I joined on 8 October 2026. Chris Lane advised me to contact you for access to the following courses:'
  },
  { type: 'list', ordered: false, items: [bullet('Radiation Safety training'), bullet('IV Skills')] },
  { type: 'paragraph', text: QUOTED_EMAIL_DETAILS },
  {
    type: 'paragraph',
    text: 'I understand I will have 30 days from receiving the login details to complete the courses and download my certificates.'
  },
  { type: 'paragraph', text: 'Thank you very much.' },
  { type: 'paragraph', text: QUOTED_EMAIL_SIGN_OFF }
]

describe('an email draft quoted in a reply', () => {
  for (const [name, source] of [
    ['soft newlines, as the agent wrote it', QUOTED_EMAIL_REPLY],
    ['two trailing spaces', QUOTED_EMAIL_REPLY_TWO_SPACES],
    ['a trailing backslash', QUOTED_EMAIL_REPLY_BACKSLASH]
  ] as const) {
    it(`reads the quote as paragraphs, a list and line-broken details, written with ${name}`, () => {
      expect(onlyQuote(source).members).toEqual(EXPECTED_MEMBERS)
    })
  }

  it('keeps the prose outside the quote filled to the width, as before', () => {
    const blocks = parseMobileMarkdown('Alex has 30 days\nfrom the moment.\n\n> a')
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Alex has 30 days from the moment.' })
  })

  it('draws the quote natively with hanging bullets, a line per detail, the address linked and single gaps', () => {
    const members = onlyQuote(QUOTED_EMAIL_REPLY).members.filter(
      (member): member is Exclude<MobileMarkdownQuoteMember, { type: 'quote' }> => member.type !== 'quote'
    )
    expect(members).toHaveLength(EXPECTED_MEMBERS.length)
    const model = buildNativeProseModel(members, {
      typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
      opensFiles: false
    })!
    expect(model).not.toBeNull()
    const items = model.paragraphs.filter((paragraph) => paragraph.kind === 'item')
    expect(items.map((item) => model.text.slice(item.start, item.end))).toEqual(['• Radiation Safety training', '• IV Skills'])
    for (const item of items) {
      expect(item.indent).toBe(NATIVE_PROSE_LIST_INDENT)
      expect(item.hang).toBe(2)
    }
    const lines = model.paragraphs.map((paragraph) => model.text.slice(paragraph.start, paragraph.end))
    expect(lines).toContain('Name: Alex Morgan')
    expect(lines).toContain('Nurse, MV Example')
    // One gap between two blocks, never two in a row.
    model.paragraphs.forEach((paragraph, index) => {
      if (paragraph.kind === 'gap') {
        expect(model.paragraphs[index + 1]?.kind).not.toBe('gap')
      }
    })
    expect(model.paragraphs.filter((paragraph) => paragraph.kind === 'gap')).toHaveLength(EXPECTED_MEMBERS.length - 1)
    expect(model.links).toEqual([{ kind: 'href', href: 'mailto:alex.morgan42@example.com' }])
    const link = model.spans.find((span) => span.style === 'link')!
    expect(model.text.slice(link.start, link.end)).toBe('alex.morgan42@example.com')
  })

  it('copies with the list items, the line breaks and one blank line between paragraphs', () => {
    expect(markdownPlainText(QUOTED_EMAIL_REPLY)).toBe(QUOTED_EMAIL_COPY)
    expect(nativeChatReplyPlainText([{ type: 'text', text: QUOTED_EMAIL_REPLY }])).toBe(QUOTED_EMAIL_COPY)
  })
})

// Review of the fix, 2026-10-10: three shapes the quote's Markdown has to keep.
describe('a quote’s Markdown at its edges', () => {
  it('keeps an italic that crosses a line break in a quote italic, on screen and on the clipboard', () => {
    // Inside a quote a newline is a line break now, and an italic could not
    // cross one: `*italic\ncontinued*` drew and copied its stars.
    for (const source of ['> *italic\n> continued*', '> _italic\n> continued_', '> - *italic\n>   continued*']) {
      const quote = onlyQuote(source)
      const members = quote.members.filter(
        (member): member is Exclude<MobileMarkdownQuoteMember, { type: 'quote' }> => member.type !== 'quote'
      )
      const model = buildNativeProseModel(members, { typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, opensFiles: false })!
      expect(model.text, source).toMatch(/^(• )?italic\ncontinued$/)
      expect(model.spans.filter((span) => span.style === 'italic'), source).toHaveLength(1)
      expect(markdownPlainText(source), source).toMatch(/^(• )?italic\n(  )?continued$/)
    }
  })

  it('draws a quote nested past four bars as its source in the fourth, as it was', () => {
    const quote = onlyQuote(`${'> '.repeat(60)}deep`)
    let depth = 1
    let members = quote.members
    while (members.length === 1 && members[0]!.type === 'quote') {
      members = members[0]!.members
      depth += 1
    }
    expect(depth).toBe(4)
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ type: 'paragraph' })
    const text = (members[0] as { text: string }).text
    expect(text.endsWith('deep')).toBe(true)
    expect(text.startsWith('> ')).toBe(true)
  })
})
