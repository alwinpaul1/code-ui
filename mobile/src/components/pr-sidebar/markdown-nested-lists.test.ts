import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from './markdown-blocks'

// Review, 2026-09-30: a PR comment's list was a flat run of strings, so
// '- parent\n  - child' drew child as a sibling of parent, and a bot's or a
// PR template's checklist, '- [x] done', drew a literal "[x]". The drawing is
// pinned in CommentMarkdown.lists.test.tsx.

const bullet = (depth: number) => ({ depth, ordered: false })
const numbered = (depth: number, number: number) => ({ depth, ordered: true, number })

describe('a nested list in a PR comment', () => {
  it('keeps a child indented to its parent\'s words one level under it', () => {
    expect(parseMarkdownBlocks('- parent\n  - child\n- sibling')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: ['parent', 'child', 'sibling'],
        shapes: [bullet(0), bullet(1), bullet(0)]
      }
    ])
  })

  it('nests three deep and steps back out to the right level', () => {
    const [block] = parseMarkdownBlocks('- a\n  - b\n    - c\n  - d\n- e')
    expect(block).toMatchObject({ items: ['a', 'b', 'c', 'd', 'e'], shapes: [bullet(0), bullet(1), bullet(2), bullet(1), bullet(0)] })
  })

  it('keeps a one-space indent a sibling, as CommonMark does', () => {
    expect(parseMarkdownBlocks('- a\n - b')).toEqual([{ kind: 'list', ordered: false, items: ['a', 'b'] }])
  })

  it('needs three columns under a numbered item, and numbers each level by itself', () => {
    const [block] = parseMarkdownBlocks('1. a\n   1. x\n   2. y\n2. b')
    expect(block).toEqual({
      kind: 'list',
      ordered: true,
      items: ['a', 'x', 'y', 'b'],
      shapes: [numbered(0, 1), numbered(1, 1), numbered(1, 2), numbered(0, 2)]
    })
    // Two columns under `1. ` is not its words: a new list at the margin.
    expect(parseMarkdownBlocks('1. a\n  - x')).toEqual([
      { kind: 'list', ordered: true, items: ['a'] },
      { kind: 'list', ordered: false, items: ['x'] }
    ])
  })

  it('reads a numbered list under a bullet, and a bulleted one under a number', () => {
    expect(parseMarkdownBlocks('- a\n  1. x\n  2. y\n- b')[0]).toMatchObject({
      ordered: false,
      items: ['a', 'x', 'y', 'b'],
      shapes: [bullet(0), numbered(1, 1), numbered(1, 2), bullet(0)]
    })
    expect(parseMarkdownBlocks('3. a\n   - x\n4. b')[0]).toMatchObject({
      ordered: true,
      items: ['a', 'x', 'b'],
      shapes: [numbered(0, 3), bullet(1), numbered(0, 4)]
    })
  })

  it('starts a nested numbered list at its own first number', () => {
    expect(parseMarkdownBlocks('- a\n  3. x\n  3. y')[0]).toMatchObject({
      shapes: [bullet(0), numbered(1, 3), numbered(1, 4)]
    })
  })

  it('opens an indented list with no parent above it at the top level', () => {
    expect(parseMarkdownBlocks('  - a\n  - b')).toEqual([{ kind: 'list', ordered: false, items: ['a', 'b'] }])
    expect(parseMarkdownBlocks('   - a\n     - b')[0]).toMatchObject({ shapes: [bullet(0), bullet(1)] })
  })

  it('joins a wrapped line to the nested item it continues', () => {
    expect(parseMarkdownBlocks('- a\n  - b\n    wraps here\n- c')[0]).toMatchObject({
      items: ['a', 'b wraps here', 'c'],
      shapes: [bullet(0), bullet(1), bullet(0)]
    })
  })

  it('keeps the level of the item after a fence under a nested item', () => {
    expect(parseMarkdownBlocks('- a\n  - b\n    ```\n    x\n    ```\n  - c\n- d')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'], shapes: [bullet(0), bullet(1)] },
      { kind: 'code', text: 'x', lang: '' },
      { kind: 'list', ordered: false, items: ['c', 'd'], shapes: [bullet(1), bullet(0)] }
    ])
  })
})

describe('a task list in a PR comment', () => {
  it('reads [x] and [ ] after the marker as a checked and an unchecked box', () => {
    expect(parseMarkdownBlocks('- [x] done\n- [ ] todo')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: ['done', 'todo'],
        shapes: [
          { ...bullet(0), checked: true },
          { ...bullet(0), checked: false }
        ]
      }
    ])
    expect(parseMarkdownBlocks('- [X] Done')[0]).toMatchObject({ items: ['Done'], shapes: [{ checked: true }] })
    expect(parseMarkdownBlocks('1. [x] step')[0]).toMatchObject({ items: ['step'], shapes: [{ ...numbered(0, 1), checked: true }] })
  })

  it('reads a task nested under a task', () => {
    expect(parseMarkdownBlocks('- [ ] parent\n  - [x] child')[0]).toMatchObject({
      items: ['parent', 'child'],
      shapes: [
        { ...bullet(0), checked: false },
        { ...bullet(1), checked: true }
      ]
    })
  })

  it('reads an empty task as an unchecked box with no words', () => {
    expect(parseMarkdownBlocks('- [ ]')).toEqual([
      { kind: 'list', ordered: false, items: [''], shapes: [{ ...bullet(0), checked: false }] }
    ])
  })

  it('leaves a link, a box glued to its words and a box further in as the item\'s words', () => {
    expect(parseMarkdownBlocks('- [link](https://x.dev)')).toEqual([
      { kind: 'list', ordered: false, items: ['[link](https://x.dev)'] }
    ])
    expect(parseMarkdownBlocks('- [x]done')).toEqual([{ kind: 'list', ordered: false, items: ['[x]done'] }])
    expect(parseMarkdownBlocks('- see [x] here')).toEqual([{ kind: 'list', ordered: false, items: ['see [x] here'] }])
    expect(parseMarkdownBlocks('- [y] no')).toEqual([{ kind: 'list', ordered: false, items: ['[y] no'] }])
  })

  it.each([
    { name: 'a list nested hundreds deep', text: Array.from({ length: 500 }, (_, k) => `${' '.repeat(2 * k)}- x`).join('\n') },
    { name: 'deep then back to the margin, many times', text: `${Array.from({ length: 200 }, (_, k) => `${' '.repeat(2 * k)}- x`).join('\n')}\n- y\n`.repeat(50) },
    { name: 'thousands of tasks', text: '- [x] a\n  - [ ] b\n'.repeat(10_000) }
  ])('reads $name within the parser deadline', ({ text }) => {
    const blocks = runInNewContext('parse(text)', { parse: parseMarkdownBlocks, text }, { timeout: 500 })
    expect(Array.isArray(blocks)).toBe(true)
  })
})
