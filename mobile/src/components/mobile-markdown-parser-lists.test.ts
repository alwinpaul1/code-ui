import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

/**
 * 2026-09-15 from the phone: opening CLAUDE.md, every numbered item was "1."
 * and the wrapped text under each one fell out to the left margin as its own
 * paragraph.
 *
 * The list loop only continued while the NEXT line carried a marker, so an
 * indented continuation line ended the list and the item after it began a new
 * one — a list of one, numbered 1, again and again. Markdown hard-wrapped at 80
 * columns is the normal shape of this project's own docs, and of anything an
 * agent writes, so the chat renders it too.
 */
describe('a list whose items are hard-wrapped over several lines', () => {
  const SOURCE = [
    'So, for every reported bug:',
    '',
    '1. **Write the failing test first**, from the real symptom, in the same commit,',
    '   and **watch it fail on the unfixed code**. "Fails" means you saw it go red,',
    '   not that you believe it would.',
    '2. **Feed it the real screen, not a paraphrase.** Terminal parsers break on',
    '   the exact bytes an agent paints.'
  ].join('\n')

  it('keeps it as one list, numbered in order', () => {
    const lists = parseMobileMarkdown(SOURCE).filter((block) => block.type === 'list')
    expect(lists).toHaveLength(1)
    expect((lists[0] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('keeps each item’s wrapped text inside that item', () => {
    const [list] = parseMobileMarkdown(SOURCE).filter((block) => block.type === 'list')
    const items = (list as { items: { text: string }[] }).items
    expect(items[0]?.text).toContain('watch it fail on the unfixed code')
    expect(items[0]?.text).toContain('not that you believe it would')
    expect(items[1]?.text).toContain('the exact bytes an agent paints')
  })

  it('rejoins a wrapped line with a space, not a line break', () => {
    const [list] = parseMobileMarkdown(SOURCE).filter((block) => block.type === 'list')
    expect((list as { items: { text: string }[] }).items[0]?.text).not.toContain('\n')
  })

  // A paragraph after the list is not part of the last item.
  it('does not swallow the paragraph that follows it', () => {
    const blocks = parseMobileMarkdown(`- one\n- two\n\nA new paragraph.`)
    expect(blocks.at(-1)?.type).toBe('paragraph')
  })
})
