import { describe, expect, it } from 'vitest'
import { NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE } from '../../../src/shared/native-chat-visual-directive'
import { markdownDocumentSource, normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { buildProseRuns } from './mobile-markdown-prose-runs'
import {
  protectMobileMarkdownVisualLines,
  withMobileMarkdownVisualBlocks
} from './mobile-markdown-visual-lines'

/** The same steps MobileMarkdown runs when a transcript renders visuals (use-mobile-markdown-blocks). */
function blocksOf(content: string) {
  const { text, directives, lines } = protectMobileMarkdownVisualLines(markdownDocumentSource(content))
  return {
    directives,
    blocks: withMobileMarkdownVisualBlocks(
      parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text)),
      lines
    )
  }
}

describe('native-chat visual lines in mobile markdown', () => {
  it('turns a directive line into its own block between prose', () => {
    const { directives, blocks } = blocksOf(
      'Here is the chart.\n::orca-visual{file="usage-3f2a.html" title="Usage"}\nIt shows a dip.'
    )
    expect(directives).toEqual([{ file: 'usage-3f2a.html', title: 'Usage' }])
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Here is the chart.' },
      { type: 'visual', index: 0 },
      { type: 'paragraph', text: 'It shows a dip.' }
    ])
  })

  it('draws the visual between two prose runs, never inside one (Android draws runs natively)', () => {
    const { blocks } = blocksOf('# Usage\nBefore.\n::orca-visual{file="a.html"}\nAfter.')
    const runs = buildProseRuns(blocks, () => false)
    expect(runs.map((run) => (run.prose ? 'prose' : run.blocks[0]!.type))).toEqual([
      'prose',
      'visual',
      'prose'
    ])
  })

  it('keeps the title exactly as written, before entity decoding and tag stripping', () => {
    const { directives } = blocksOf('::orca-visual{file="a.html" title="<b>Q1</b> &amp; Q2"}')
    expect(directives).toEqual([{ file: 'a.html', title: '<b>Q1</b> &amp; Q2' }])
  })

  it('accepts CRLF line endings and up to three leading spaces', () => {
    const { blocks } = blocksOf('intro\r\n   ::orca-visual{file="a.html"}\r\nend')
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'visual', 'paragraph'])
  })

  it('leaves directives inside fenced code, quotes, list items and inline code as text', () => {
    const fenced = blocksOf('```md\n::orca-visual{file="a.html"}\n```')
    expect(fenced.directives).toEqual([])
    expect(fenced.blocks).toHaveLength(1)
    expect(fenced.blocks[0]).toMatchObject({ type: 'code', text: '::orca-visual{file="a.html"}' })
    expect(blocksOf('> ::orca-visual{file="a.html"}').directives).toEqual([])
    expect(blocksOf('- ::orca-visual{file="a.html"}').directives).toEqual([])
    expect(blocksOf('see `::orca-visual{file="a.html"}`').directives).toEqual([])
    expect(blocksOf('text\n\n    ::orca-visual{file="a.html"}').directives).toEqual([])
  })

  // The fork parses with marked (CommonMark); upstream's line parser knew only ``` fences.
  it('treats tilde and longer fences as code, as the block parser does', () => {
    expect(blocksOf('~~~\n::orca-visual{file="a.html"}\n~~~').directives).toEqual([])
    // Three backticks do not close a four-backtick fence, so the directive is still code.
    expect(blocksOf('````md\n```\n::orca-visual{file="a.html"}\n````').directives).toEqual([])
    // A tilde line does not close a backtick fence.
    expect(blocksOf('```\n~~~\n::orca-visual{file="a.html"}\n```').directives).toEqual([])
  })

  // Review of the port (2026-10-10): a line opening with inline triple-backtick code is not a fence.
  it('keeps recognizing directives after a line that opens with inline triple-backtick code', () => {
    const { directives, blocks } = blocksOf('```npm i``` first\n\n::orca-visual{file="a.html" title="A"}\n\nafter')
    expect(directives).toEqual([{ file: 'a.html', title: 'A' }])
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'visual', 'paragraph'])
  })

  // Review of the port: where marked keeps a placeholder inside another block, the reader sees the
  // directive line as before, never the private-use placeholder.
  it('never draws a placeholder where marked folds the line into another block', () => {
    for (const content of [
      '<!-- todo\n\n::orca-visual{file="a.html"}',
      '- step\n  ```\n::orca-visual{file="a.html"}\n  ```\ntext\n::orca-visual{file="b.html"}'
    ]) {
      const { blocks } = blocksOf(content)
      expect(JSON.stringify(blocks), content).not.toContain('ORCA_VISUAL')
    }
  })

  it('resumes recognizing directives after a fence closes', () => {
    const { directives } = blocksOf('```\ncode\n```\n::orca-visual{file="after.html"}')
    expect(directives).toEqual([{ file: 'after.html', title: null }])
  })

  it('leaves malformed or path-like directives as literal text', () => {
    for (const line of [
      '::orca-visual{file="../secret.html"}',
      '::orca-visual{file="a.html" file="b.html"}',
      '::orca-visual{file="a.htm"}',
      '::orca-visual{file="a.html"',
      '::orca-visual{file="a.html"} trailing words'
    ]) {
      const { directives, blocks } = blocksOf(line)
      expect(directives, line).toEqual([])
      expect(blocks.map((block) => block.type), line).toEqual(['paragraph'])
    }
  })

  it('renders directives past the per-message cap as text', () => {
    const lines = Array.from(
      { length: NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE + 1 },
      (_, index) => `::orca-visual{file="v${index}.html"}`
    )
    const { directives, blocks } = blocksOf(lines.join('\n'))
    expect(directives).toHaveLength(NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE)
    expect(blocks.filter((block) => block.type === 'visual')).toHaveLength(
      NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE
    )
    expect(blocks.at(-1)).toEqual({ type: 'paragraph', text: lines.at(-1) })
  })

  it('renders a reply that is one visual and nothing else', () => {
    const { blocks } = blocksOf('::orca-visual{file="only.html"}')
    expect(blocks).toEqual([{ type: 'visual', index: 0 }])
  })

  it('renders no visuals for text that already spells a placeholder', () => {
    const { directives } = blocksOf('\uE000ORCA_VISUAL_0\uE000\n::orca-visual{file="a.html"}')
    expect(directives).toEqual([])
  })

  it('never treats a placeholder-looking line as a visual when none were protected', () => {
    const blocks = parseMobileMarkdown('\uE000ORCA_VISUAL_0\uE000')
    expect(withMobileMarkdownVisualBlocks(blocks, [])).toBe(blocks)
    expect(withMobileMarkdownVisualBlocks(blocks, [])).toEqual([
      { type: 'paragraph', text: '\uE000ORCA_VISUAL_0\uE000' }
    ])
  })

  it('parses an empty document to no blocks with visuals on', () => {
    expect(blocksOf('')).toEqual({ directives: [], blocks: [] })
  })
})
