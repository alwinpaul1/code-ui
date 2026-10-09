import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { buildProseRuns, type ProseBlock } from './mobile-markdown-prose-runs'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import {
  NATIVE_PROSE_LIST_DEPTH_INDENT,
  NATIVE_PROSE_LIST_INDENT,
  NATIVE_PROSE_LIST_ITEM_GAP,
  buildNativeProseModel,
  type NativeProseModel
} from './native-prose-model'

// 2026-10-09: the user wants the chat transcript to read like the Claude
// Android app: bullets indented from the margin, a wrapped bullet line hanging
// under the bullet's words, a little air between bullets, bold lead-ins, and a
// selection that still drags across a whole reply and copies the words as
// drawn. Android draws that as ONE TextView holding one Spannable
// (modules/orca-native-prose); this model is what it is built from, 1:1.
//
// The fixture is the reply in the user's reference screenshot
// (uploads/.../f8d080d8-image.jpg, the Claude app's thumbnail on the left),
// in the Markdown Claude Code wrote it in.
const REPLY = [
  "One finding changes what you'll see. The `68.3k/1.0M` row isn't printed by your status line script: your usage-band mod draws it above the input box. So:",
  '',
  '- **Wide pane (wider than 100 columns):** every Claude tab gets the ring, hand-typed and fullscreen included.',
  '- **Narrow pane (100 columns or less):** no ring from it. Showing a ring from `7%` alone is possible, but it’s a new decision for you.',
  '',
  'It refuses anything ambiguous: figures quoted in the chat, and rows that were cut off.'
].join('\n')

function modelOf(markdown: string, onOpenFile = false): NativeProseModel | null {
  const runs = buildProseRuns(parseMobileMarkdown(markdown), () => false)
  expect(runs).toHaveLength(1)
  return buildNativeProseModel(runs[0]!.prose as ProseBlock[], {
    typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
    opensFiles: onOpenFile
  })
}

function paragraphText(model: NativeProseModel, index: number): string {
  const paragraph = model.paragraphs[index]!
  return model.text.slice(paragraph.start, paragraph.end)
}

function spanTexts(model: NativeProseModel, style: string): string[] {
  return model.spans.filter((span) => span.style === style).map((span) => model.text.slice(span.start, span.end))
}

describe('a reply drawn as one native text, as the Claude app sets it', () => {
  it('copies as the words drawn: bullets as •, no stars, backticks or list dashes', () => {
    const model = modelOf(REPLY)!
    expect(model.text).toBe(
      [
        "One finding changes what you'll see. The 68.3k/1.0M row isn't printed by your status line script: your usage-band mod draws it above the input box. So:",
        '',
        '• Wide pane (wider than 100 columns): every Claude tab gets the ring, hand-typed and fullscreen included.',
        '• Narrow pane (100 columns or less): no ring from it. Showing a ring from 7% alone is possible, but it’s a new decision for you.',
        '',
        'It refuses anything ambiguous: figures quoted in the chat, and rows that were cut off.'
      ].join('\n')
    )
    expect(model.text).not.toMatch(/[*`]/)
  })

  it('hangs a wrapped bullet line under the words, not under the bullet', () => {
    const model = modelOf(REPLY)!
    const items = model.paragraphs.filter((paragraph) => paragraph.kind === 'item')
    expect(items).toHaveLength(2)
    for (const item of items) {
      // The first line starts at the list indent; every later line starts
      // where the marker and its space end, which the native side measures in
      // the paint the marker is drawn in.
      expect(item.indent).toBe(NATIVE_PROSE_LIST_INDENT)
      expect(model.text.slice(item.start, item.start + item.hang)).toBe('• ')
    }
  })

  it('indents a nested bullet one more step and hangs it under its own words', () => {
    const model = modelOf('- top\n  - nested item that wraps\n- back')!
    const items = model.paragraphs.filter((paragraph) => paragraph.kind === 'item')
    expect(items.map((item) => item.indent)).toEqual([
      NATIVE_PROSE_LIST_INDENT,
      NATIVE_PROSE_LIST_INDENT + NATIVE_PROSE_LIST_DEPTH_INDENT,
      NATIVE_PROSE_LIST_INDENT
    ])
    expect(model.text.slice(items[1]!.start, items[1]!.start + items[1]!.hang)).toBe('◦ ')
  })

  it('puts air between bullets but none after the last, and the block gap around the list', () => {
    const model = modelOf(REPLY)!
    const kinds = model.paragraphs.map((paragraph) => paragraph.kind)
    expect(kinds).toEqual(['body', 'gap', 'item', 'item', 'gap', 'body'])
    const [, gap, first, second] = model.paragraphs
    expect(first!.spaceAfter).toBe(NATIVE_PROSE_LIST_ITEM_GAP)
    expect(second!.spaceAfter).toBe(0)
    // The blank line between blocks is a newline a selection crosses and a
    // copy keeps, drawn 7 dp tall (TRANSCRIPT_MARKDOWN_TYPOGRAPHY.blockGap).
    expect(gap!.lineHeight).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.blockGap)
    expect(paragraphText(model, 1)).toBe('')
    expect(model.paragraphs.every((paragraph) => paragraph.kind === 'gap' || paragraph.lineHeight === 21)).toBe(true)
  })

  it('draws the bold lead-ins bold and the code as pills, over the drawn words', () => {
    const model = modelOf(REPLY)!
    expect(spanTexts(model, 'bold')).toEqual([
      'Wide pane (wider than 100 columns):',
      'Narrow pane (100 columns or less):'
    ])
    expect(spanTexts(model, 'code')).toEqual(['68.3k/1.0M', '7%'])
  })

  it('tiles the text with its paragraphs, one newline between each', () => {
    for (const markdown of [REPLY, '# Title\n\nbody\n\n---\n\n1. one\n2. two', 'x']) {
      const model = modelOf(markdown)!
      const rebuilt = model.paragraphs.map((paragraph) => model.text.slice(paragraph.start, paragraph.end)).join('\n')
      expect(rebuilt).toBe(model.text)
      model.paragraphs.forEach((paragraph, index) => {
        const next = model.paragraphs[index + 1]
        if (next) {
          expect(next.start).toBe(paragraph.end + 1)
        } else {
          expect(paragraph.end).toBe(model.text.length)
          // Nothing drawn below the last line: the height measured is the
          // text's own.
          expect(paragraph.spaceAfter).toBe(0)
        }
      })
    }
  })

  it('sets a heading at its level and in the bold face', () => {
    const model = modelOf('## Plan\n\nThen the body.')!
    const heading = model.paragraphs[0]!
    expect(heading.kind).toBe('heading')
    expect(heading.fontSize).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.headingLevel2.fontSize)
    expect(heading.lineHeight).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.headingLevel2.lineHeight)
    expect(spanTexts(model, 'bold')).toEqual(['Plan'])
    expect(model.text).toBe('Plan\n\nThen the body.')
  })

  it('numbers an ordered list and hangs each item under its own number', () => {
    const model = modelOf('3. three\n4. four')!
    expect(model.text).toBe('3. three\n4. four')
    expect(model.paragraphs.map((paragraph) => paragraph.hang)).toEqual([3, 3])
  })

  it('opens a link from its words and copies only the words', () => {
    const model = modelOf('See [the docs](https://example.com/a) and https://b.example.org.')!
    expect(model.text).toBe('See the docs and https://b.example.org.')
    expect(spanTexts(model, 'link')).toEqual(['the docs', 'https://b.example.org'])
    expect(model.links).toEqual([
      { kind: 'href', href: 'https://example.com/a' },
      { kind: 'href', href: 'https://b.example.org' }
    ])
    const linkSpans = model.spans.filter((span) => span.style === 'link')
    expect(linkSpans.map((span) => span.link)).toEqual([0, 1])
  })

  it('makes a file path tappable only where the surface opens files', () => {
    const withFiles = modelOf('Changed `mobile/src/app.ts` and mobile/src/other.ts here.', true)!
    expect(withFiles.links).toEqual([
      { kind: 'file', path: 'mobile/src/app.ts' },
      { kind: 'file', path: 'mobile/src/other.ts' }
    ])
    expect(spanTexts(withFiles, 'code')).toEqual(['mobile/src/app.ts'])
    const without = modelOf('Changed `mobile/src/app.ts` and mobile/src/other.ts here.', false)!
    expect(without.links).toEqual([])
    expect(without.spans.some((span) => span.style === 'link')).toBe(false)
  })

  it('draws a rule as a line of box characters a copy keeps', () => {
    const model = modelOf('above\n\n---\n\nbelow')!
    const rule = model.paragraphs.find((paragraph) => paragraph.kind === 'rule')!
    expect(model.text.slice(rule.start, rule.end)).toMatch(/^─+$/)
    expect(spanTexts(model, 'rule')).toHaveLength(1)
  })

  it('counts offsets in UTF-16 units, as a Java String does', () => {
    const model = modelOf('🙂 **bold** after')!
    expect(spanTexts(model, 'bold')).toEqual(['bold'])
    expect(model.spans[0]!.start).toBe(3)
  })

  it('keeps a hard break inside a bullet under the bullet’s words', () => {
    const model = modelOf('- first line  \n  second line\n- next')!
    expect(model.text).toBe('• first line\nsecond line\n• next')
    const [first, broken, next] = model.paragraphs
    expect(first!.kind).toBe('item')
    expect(first!.spaceAfter).toBe(0)
    // The rest of the item lines up with the item's words, whatever the
    // marker measures: it borrows that item's hanging margin.
    expect(broken!.alignTo).toBe(0)
    expect(broken!.spaceAfter).toBe(NATIVE_PROSE_LIST_ITEM_GAP)
    expect(next!.alignTo).toBeUndefined()
  })

  it('draws bold and code that run over a hard break as bold and code, not as stars and backticks', () => {
    // The Text path reads a paragraph in ONE inline pass for this reason
    // (MobileMarkdown.tsx, reported from the device); a pass per line left
    // `**bold` and `text**` as literal stars.
    const model = buildNativeProseModel([{ type: 'paragraph', text: '**bold\ntext** after `a\nb` y' }], {
      typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
      opensFiles: false
    })!
    expect(model.text).toBe('bold\ntext after a\nb y')
    expect(spanTexts(model, 'bold')).toEqual(['bold\ntext'])
    expect(spanTexts(model, 'code')).toEqual(['a\nb'])
    expect(model.paragraphs.map((paragraph) => paragraphText(model, model.paragraphs.indexOf(paragraph)))).toEqual([
      'bold',
      'text after a',
      'b y'
    ])
  })

  it('sets code in its own face inside bold, italic and headings: code spans come last', () => {
    // Android applies a text's metric spans in the order they were set, so a
    // bold face set after a code span would draw the code in the bold sans.
    const model = modelOf('## Fix `foo` now\n\n**see `bar`** and *`baz`* and [**`q`**](https://x.y)')!
    const lastOther = Math.max(
      ...model.spans.map((span, index) => (span.style === 'code' || span.style === 'labelCode' ? -1 : index))
    )
    const firstCode = model.spans.findIndex((span) => span.style === 'code' || span.style === 'labelCode')
    expect(spanTexts(model, 'code')).toEqual(['foo', 'bar', 'baz'])
    expect(spanTexts(model, 'labelCode')).toEqual(['q'])
    expect(firstCode).toBeGreaterThan(lastOther)
  })

  it('draws a one-item list and a one-character reply with nothing after them', () => {
    const one = modelOf('- only')!
    expect(one.text).toBe('• only')
    expect(one.paragraphs).toHaveLength(1)
    expect(one.paragraphs[0]!.spaceAfter).toBe(0)
    const tiny = modelOf('x')!
    expect(tiny.paragraphs).toEqual([
      expect.objectContaining({ kind: 'body', start: 0, end: 1, spaceAfter: 0 })
    ])
  })

  it('refuses a run with an image in it, which only the Text path can draw', () => {
    const runs = buildProseRuns(parseMobileMarkdown('Before\n\n![fig](fig/plot.svg)'), () => false)
    expect(
      buildNativeProseModel(runs[0]!.prose as ProseBlock[], {
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        opensFiles: false
      })
    ).toBeNull()
  })

  it('refuses an empty run rather than draw a zero-line text', () => {
    expect(
      buildNativeProseModel([], { typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, opensFiles: false })
    ).toBeNull()
  })
})
