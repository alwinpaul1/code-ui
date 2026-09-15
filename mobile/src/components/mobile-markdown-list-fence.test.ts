import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

// The shape an agent writes more than any other: a numbered step, then the
// command for that step underneath it. It used to keep its fence as RAW SOURCE
// inside the item's text, where the inline matcher rendered it as one code chip
// with stray backticks — no code styling, no horizontal scroller, no mermaid,
// and the newlines inside it collapsed. The fence is a block; it has to come
// out of the item and be drawn as one.
describe('a command written under a list step', () => {
  it('draws the fence as a code block, not as chips inside the item', () => {
    const blocks = parseMobileMarkdown(
      ['1. Install it:', '', '   ```sh', '   pnpm install', '   ```', '', '2. Run it.'].join('\n')
    )
    expect(blocks.map((block) => block.type)).toEqual(['list', 'code', 'list'])
    const [first, code, second] = blocks
    expect(first).toMatchObject({
      type: 'list',
      items: [{ text: 'Install it:', number: 1, depth: 0 }]
    })
    expect(code).toEqual({ type: 'code', text: 'pnpm install', language: 'sh', closed: true })
    // The list picks up where it left off: `2.` is still 2.
    expect(second).toMatchObject({ type: 'list', items: [{ text: 'Run it.', number: 2 }] })
  })

  it('keeps the fence at the item’s own depth so a nested step reads as one', () => {
    const blocks = parseMobileMarkdown(
      ['- Outer', '  - Inner step', '', '    ```', '    do-it', '    ```'].join('\n')
    )
    expect(blocks.map((block) => block.type)).toEqual(['list', 'code'])
    const first = blocks[0]
    expect(first).toMatchObject({
      type: 'list',
      items: [
        { text: 'Outer', depth: 0 },
        { text: 'Inner step', depth: 1 }
      ]
    })
    expect(blocks[1]).toEqual({ type: 'code', text: 'do-it', language: undefined, closed: true })
  })

  it('still streams: an unterminated fence under a step is not called closed', () => {
    const blocks = parseMobileMarkdown(['1. Draw it:', '', '   ```mermaid', '   graph TD'].join('\n'))
    const code = blocks.find((block) => block.type === 'code')
    expect(code).toMatchObject({ type: 'code', language: 'mermaid', closed: false })
  })

  it('loses nothing when an item holds prose on both sides of the fence', () => {
    const blocks = parseMobileMarkdown(
      ['- Before', '', '  ```', '  middle', '  ```', '', '  After'].join('\n')
    )
    expect(blocks.map((block) => block.type)).toEqual(['list', 'code', 'list'])
    expect(blocks[0]).toMatchObject({ items: [{ text: 'Before' }] })
    expect(blocks[1]).toMatchObject({ text: 'middle' })
    expect(blocks[2]).toMatchObject({ items: [{ text: 'After' }] })
  })

  it('keeps the outer list going after a fence inside a nested step', () => {
    const blocks = parseMobileMarkdown(
      [
        '- Outer one',
        '  - Nested:',
        '',
        '    ```sh',
        '    run-me',
        '    ```',
        '',
        '- Outer two'
      ].join('\n')
    )
    expect(blocks.map((block) => block.type)).toEqual(['list', 'code', 'list'])
    expect(blocks[0]).toMatchObject({
      items: [
        { text: 'Outer one', depth: 0 },
        { text: 'Nested:', depth: 1 }
      ]
    })
    expect(blocks[2]).toMatchObject({ items: [{ text: 'Outer two', depth: 0 }] })
  })

  it('leaves an ordinary list as one block', () => {
    const blocks = parseMobileMarkdown(['- one', '- two', '- three'].join('\n'))
    expect(blocks.map((block) => block.type)).toEqual(['list'])
    expect(blocks[0]).toMatchObject({ items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] })
  })

  it('reads a single item that is nothing but a fence', () => {
    const blocks = parseMobileMarkdown(['- ```', '  only', '  ```'].join('\n'))
    expect(blocks.map((block) => block.type)).toEqual(['code'])
    expect(blocks[0]).toMatchObject({ text: 'only' })
  })
})
