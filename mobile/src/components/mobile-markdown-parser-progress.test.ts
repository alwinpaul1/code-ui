import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMobileMarkdown, type MobileMarkdownBlock } from './mobile-markdown-parser'

function parseWithDeadline(input: string): MobileMarkdownBlock[] {
  // A synchronous parser must fail without hanging the test worker.
  return runInNewContext('parse(input)', { parse: parseMobileMarkdown, input }, { timeout: 250 })
}

/** Everything the reader ends up seeing, in order. */
function visibleText(blocks: MobileMarkdownBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'quote':
        case 'code':
          return block.text
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

// This suite guards two things, and only these two. NOTHING MAY VANISH: a
// construct the parser cannot place still has to reach the screen. AND IT MUST
// NOT HANG: every case runs under a 250 ms deadline in its own VM context.
//
// It used to also pin the exact bytes of the old hand-rolled fallback — that
// "```c++" stayed on screen as literal paragraph text, newlines and all. That
// was an artefact of a fence regex that only accepted [A-Za-z0-9_-] as a
// language, not a contract: `c++`, `c#` and `ts title="x"` are ordinary info
// strings, and Orca's desktop renders all three as code. marked reads them the
// same way, so the fences below are now code blocks with their content intact,
// which is strictly more of the document surviving, not less.
describe('mobile Markdown parser progress', () => {
  it.each([
    ['```c++', 'c++'],
    ['```c#', 'c#'],
    ['``` ts', 'ts'],
    ['```ts title="file.ts"', 'ts'],
    ['```!', '!']
  ])('opens %s as a code fence and reads its language', (fence, language) => {
    expect(parseWithDeadline(`${fence}\nint x = 1;`)).toEqual([
      { type: 'code', text: 'int x = 1;', language, closed: false }
    ])
  })

  it('opens a four-backtick fence with no language', () => {
    expect(parseWithDeadline('````\nint x = 1;')).toEqual([
      { type: 'code', text: 'int x = 1;', closed: false }
    ])
  })

  it.each(['```c++', '```c#', '``` ts', '```ts title="file.ts"', '````', '```!'])(
    'loses nothing around %s',
    (fence) => {
      expect(visibleText(parseWithDeadline(`before\n${fence}\nafter`))).toContain('before')
      expect(visibleText(parseWithDeadline(`before\n${fence}\nafter`))).toContain('after')
    }
  )

  it('keeps a fence body line-for-line instead of reflowing it as prose', () => {
    // Prose fills the phone's width; code must not. A command split across two
    // display lines is a command the reader cannot copy.
    const blocks = parseWithDeadline('```sh\npnpm install\npnpm test\n```')
    expect(blocks).toEqual([
      { type: 'code', text: 'pnpm install\npnpm test', language: 'sh', closed: true }
    ])
  })

  it.each(['# ', '## ', '###### ', '#\t'])('does not let %s swallow the next line', (heading) => {
    const blocks = parseWithDeadline(`${heading}\nnext`)
    expect(visibleText(blocks)).toContain('next')
    expect(blocks.at(-1)).toEqual({ type: 'paragraph', text: 'next' })
  })

  it('handles an unusual fence through the production preview normalization', () => {
    const input = normalizeMobileMarkdownPreviewHtml('```c++\nint x = 1;')
    expect(parseWithDeadline(input)).toEqual([
      { type: 'code', text: 'int x = 1;', language: 'c++', closed: false }
    ])
  })

  it('treats a shorter inner fence as body text, the way the desktop does', () => {
    // CommonMark: a closing fence must be at least as long as the opener and
    // carry nothing else, so "```ts" here is content, not a new block.
    expect(parseWithDeadline('```c++\n```ts\nconst x = 1\n```')).toEqual([
      { type: 'code', text: '```ts\nconst x = 1', language: 'c++', closed: true }
    ])
  })

  it('preserves supported fences and their streaming state', () => {
    expect(parseWithDeadline('before\n```ts\nconst x = 1')).toEqual([
      { type: 'paragraph', text: 'before' },
      { type: 'code', text: 'const x = 1', language: 'ts', closed: false }
    ])
  })

  it.each([
    ['nested blockquotes', `${'> '.repeat(12_000)}buried but still here`],
    ['stacked emphasis markers', `${'*'.repeat(12_000)}buried but still here`]
  ])('hands back %s verbatim rather than throwing at the renderer', (_name, input) => {
    // marked spends a stack frame per level of blockquote and time quadratic
    // in an emphasis run's length (6.4k stacked `*` = 155 ms, 12.8k = 507 ms,
    // measured on marked 18.0.12). A throw out of the parser blanks the whole
    // message and a slow one freezes the chat, so both degrade to prose —
    // inside the deadline, with the text still on screen.
    expect(visibleText(parseWithDeadline(input))).toContain('buried but still here')
  })
})
