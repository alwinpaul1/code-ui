import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMobileMarkdown, type MobileMarkdownBlock } from './mobile-markdown-parser'

// Every case here is a defect a review found in the marked migration that the
// rest of the suite could not see, each reproduced before it was fixed.

/** What MobileMarkdown actually parses: the preview normalization runs first. */
function parseAsProduction(content: string): MobileMarkdownBlock[] {
  return parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(content))
}

function parseWithDeadline(input: string): MobileMarkdownBlock[] {
  return runInNewContext('parse(input)', { parse: parseMobileMarkdown, input }, { timeout: 250 })
}

function visibleText(blocks: MobileMarkdownBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'quote':
        case 'code':
        case 'heading':
          return block.text
        case 'list':
          return block.items.map((item) => item.text).join('\n')
        case 'table':
          return [block.headers, ...block.rows].map((row) => row.join(' ')).join('\n')
        case 'image':
          return `${block.alt} ${block.url}`
        case 'rule':
          return '---'
      }
    })
    .join('\n')
}

describe('a hard break the writer asked for', () => {
  it('survives the normalization the screen actually runs, not just the parser', () => {
    // The parser honoured `two spaces + newline`, but the preview
    // normalization strips trailing whitespace and ran FIRST, so on the device
    // the break was gone. Testing the parser alone could not see it.
    expect(parseAsProduction('first line  \nsecond line')).toEqual([
      { type: 'paragraph', text: 'first line\nsecond line' }
    ])
  })

  it('still drops a single trailing space, which is not a break', () => {
    expect(parseAsProduction('first line \nsecond line')).toEqual([
      { type: 'paragraph', text: 'first line second line'
      }
    ])
  })

  it('does not turn an escaped backslash at the end of a line into one', () => {
    // `C:\\` is an escaped backslash plus a soft break: a space, per CommonMark.
    expect(parseMobileMarkdown('the path is C:\\\\\nthen continue')).toEqual([
      { type: 'paragraph', text: 'the path is C:\\\\ then continue' }
    ])
    // An odd run still ends in an unescaped backslash, so it still breaks.
    expect(parseMobileMarkdown('first line\\\nsecond line')).toEqual([
      { type: 'paragraph', text: 'first line\nsecond line' }
    ])
  })
})

describe('a fence that is still streaming', () => {
  it.each([
    ['a three-backtick line cannot close a four-backtick fence', '````mermaid\ngraph TD; A-->B\n```'],
    ['backticks cannot close a tilde fence', '~~~mermaid\ngraph TD; A-->B\n```'],
    ['tildes cannot close a backtick fence', '```mermaid\ngraph TD; A-->B\n~~~']
  ])('is not reported closed because %s', (_why, source) => {
    // closed=true mounts the mermaid WebView, and mounting it mid-stream
    // reloads its document on every tick.
    expect(parseMobileMarkdown(source)[0]).toMatchObject({ type: 'code', closed: false })
  })

  it('is reported closed by a terminator at least as long as its opener', () => {
    expect(parseMobileMarkdown('````mermaid\ngraph TD; A-->B\n````')[0]).toMatchObject({
      closed: true
    })
    expect(parseMobileMarkdown('```mermaid\ngraph TD; A-->B\n`````')[0]).toMatchObject({
      closed: true
    })
    expect(parseMobileMarkdown('~~~mermaid\ngraph TD; A-->B\n~~~')[0]).toMatchObject({
      closed: true
    })
  })
})

describe('a link reference definition', () => {
  it('keeps its URL on screen rather than leaving a blank message', () => {
    // Hiding it matches the desktop, but the inline matcher cannot resolve
    // `[text][d]`, so hiding it took the only copy of the URL off the screen —
    // and a message that was only definitions rendered as an empty View.
    expect(parseMobileMarkdown('[d]: https://example.com')).toEqual([
      { type: 'paragraph', text: '[d]: https://example.com' }
    ])
  })

  it('keeps a run of them in one paragraph', () => {
    const blocks = parseMobileMarkdown(
      'See the [docs][1] and the [spec][2].\n\n[1]: https://example.com/docs\n[2]: https://example.com/spec'
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      text: '[1]: https://example.com/docs\n[2]: https://example.com/spec'
    })
  })
})

describe('what the runaway-nesting guard refuses', () => {
  it('does not flatten a document over a long marker run inside a code fence', () => {
    // A progress bar or a banner in a fence is content, not nesting. Refusing
    // the whole document for it threw away the heading and the fence with it.
    const source = `# Real heading\n\n\`\`\`txt\n${'>'.repeat(400)}\n${'*'.repeat(2000)}\ndone\n\`\`\`\n\nAfter.`
    const blocks = parseWithDeadline(source)
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Real heading' })
    expect(blocks.some((block) => block.type === 'code')).toBe(true)
    expect(visibleText(blocks)).toContain('After.')
  })

  it('refuses a list nested far past any document, instead of exhausting the heap', () => {
    // marked recurses per level and a deep nested list is not a RangeError but
    // a fatal out-of-memory, which no try/catch can catch. 2000 levels killed
    // the process outright.
    const deep = Array.from({ length: 600 }, (_, level) => `${' '.repeat(level * 2)}- item`).join(
      '\n'
    )
    expect(visibleText(parseWithDeadline(`${deep}\nburied but still here`))).toContain(
      'buried but still here'
    )
  })

  it('still reads a list nested as deeply as a real document ever is', () => {
    const blocks = parseMobileMarkdown('- one\n  - two\n    - three\n      - four')
    expect(blocks[0]?.type === 'list' && blocks[0].items.map((item) => item.depth)).toEqual([
      0, 1, 2, 3
    ])
  })
})

describe('the cost of a long list while it streams', () => {
  it('parses a thousand-item list inside a frame', () => {
    const list = Array.from({ length: 1000 }, (_, index) => `${index + 1}. item ${index}`).join('\n')
    parseMobileMarkdown(list)
    const started = performance.now()
    parseMobileMarkdown(list)
    expect(performance.now() - started).toBeLessThan(16)
  })
})
