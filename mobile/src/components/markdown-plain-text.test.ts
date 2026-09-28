import { describe, expect, it } from 'vitest'
import { markdownPlainText } from './markdown-plain-text'

// What a reply's Copy puts on the clipboard (2026-09-28, the user: "Why i
// copy text markdown things come ** ** ''' fix it").

describe('markdownPlainText', () => {
  it('copies nothing for a reply that draws nothing', () => {
    expect(markdownPlainText('')).toBe('')
    expect(markdownPlainText('  \n\n ')).toBe('')
  })

  it('copies a one-word reply as that word', () => {
    expect(markdownPlainText('Done')).toBe('Done')
    expect(markdownPlainText('**Done**')).toBe('Done')
  })

  it('drops the stars, underscores and tildes the screen draws as style', () => {
    expect(markdownPlainText('**bold**, *italic*, __strong__, _em_ and ~~gone~~')).toBe(
      'bold, italic, strong, em and gone'
    )
    expect(markdownPlainText('**Alphabetical `/` menu.**')).toBe('Alphabetical / menu.')
  })

  it('keeps underscores inside a word, which the screen draws as written', () => {
    expect(markdownPlainText('call snake_case_name and foo__bar__baz')).toBe('call snake_case_name and foo__bar__baz')
  })

  it('copies a code pill as its words, backticks and padding off', () => {
    expect(markdownPlainText('only when someone runs `cdk deploy`.')).toBe('only when someone runs cdk deploy.')
    expect(markdownPlainText('`` `user` `` becomes `user`')).toBe('`user` becomes user')
  })

  it('copies a code block as its code, without the fences or the language', () => {
    expect(markdownPlainText('Run:\n\n```bash\nnpm test\nnpm run lint\n```\n\nThen push.')).toBe(
      'Run:\n\nnpm test\nnpm run lint\n\nThen push.'
    )
  })

  it('copies a fence still streaming in without its opener', () => {
    expect(markdownPlainText('```ts\nconst a = 1')).toBe('const a = 1')
  })

  it('drops the hashes off a heading', () => {
    expect(markdownPlainText('# One\n\n## Two\n\n### Three `x`')).toBe('One\n\nTwo\n\nThree x')
  })

  it('copies a quote as its words', () => {
    expect(markdownPlainText('> quoted **text**')).toBe('quoted text')
  })

  it('writes the markers the screen draws for bullets, numbers and tasks', () => {
    expect(markdownPlainText('- one')).toBe('• one')
    expect(markdownPlainText('3. three\n4. four')).toBe('3. three\n4. four')
    expect(markdownPlainText('- [ ] todo\n- [x] done')).toBe('☐ todo\n☑ done')
  })

  it('steps a nested item in, with its level\'s bullet', () => {
    expect(markdownPlainText('- top\n  - child\n    - grandchild')).toBe('• top\n  ◦ child\n    ▪ grandchild')
  })

  it('keeps the rest of an item that a fence cut in two under its words, with no second bullet', () => {
    const copied = markdownPlainText('1. Run this:\n\n   ```\n   make\n   ```\n\n   and wait.\n2. Next')
    expect(copied).not.toContain('```')
    expect(copied).toContain('1. Run this:')
    expect(copied).toContain('make')
    expect(copied).toMatch(/and wait\./)
    expect(copied).not.toMatch(/[•◦▪] and wait/)
  })

  it('keeps a web link\'s address after its words, and a file link as its words', () => {
    expect(markdownPlainText('see [the docs](https://example.com/docs)')).toBe(
      'see the docs (https://example.com/docs)'
    )
    expect(markdownPlainText('[https://x.dev](https://x.dev)')).toBe('https://x.dev')
    expect(markdownPlainText('open [`app.ts:12`](mobile/src/app.ts#L12)')).toBe('open app.ts:12')
  })

  it('leaves sentence punctuation after a bare URL where it was', () => {
    expect(markdownPlainText('go to https://example.com/a.')).toBe('go to https://example.com/a.')
  })

  it('copies an image as its words and address', () => {
    expect(markdownPlainText('![chart](https://x.dev/c.png)')).toBe('chart (https://x.dev/c.png)')
  })

  it('copies a table as tab-separated rows, marks off each cell', () => {
    expect(markdownPlainText('| Name | Size |\n| --- | --- |\n| `a.ts` | **2 KB** |')).toBe(
      'Name\tSize\na.ts\t2 KB'
    )
  })

  it('puts no empty paragraph where a rule was', () => {
    expect(markdownPlainText('above\n\n---\n\nbelow')).toBe('above\n\nbelow')
  })

  it('reads Windows line endings like any other', () => {
    expect(markdownPlainText('**a**\r\n\r\nb')).toBe('a\n\nb')
  })
})
