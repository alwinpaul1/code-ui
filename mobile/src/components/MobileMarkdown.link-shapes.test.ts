import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'

const openURL = vi.fn((_url: string) => Promise.resolve())

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Linking: { openURL: (url: string) => openURL(url) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// Review, 2026-09-30: three shapes of link the chat drew wrong. An address
// with parentheses in it (every Wikipedia disambiguation page) opened cut at
// its first `)`, a 404, and drew the rest after the words. A README badge,
// `[![CI](badge.svg)](repo)`, drew as a link to the badge IMAGE labelled
// `![CI`, then `](`, then the repo address. And `<https://x.dev/a>` drew its
// angle brackets and opened `https://x.dev/a>`. The Copy of each is pinned in
// markdown-plain-text.test.ts.

function flattenText(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : flattenText(child))).join('')
}

function pressables(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => node.type === ('Text' as never) && typeof node.props.onPress === 'function'
  )
}

function pressByText(renderer: ReactTestRenderer, text: string): void {
  const target = pressables(renderer).find((node) => flattenText(node) === text)
  expect(target, `no pressable text ${JSON.stringify(text)}`).toBeDefined()
  target!.props.onPress()
}

describe('a chat link whose address or words hold brackets', () => {
  let renderer: ReactTestRenderer | null = null
  const onOpenFile = vi.fn()

  beforeEach(() => {
    onOpenFile.mockClear()
    openURL.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(content: string): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content, onOpenFile }))
    })
    return renderer!
  }

  it('opens a Wikipedia address with parentheses in it whole, with no stray bracket after its words', () => {
    const tree = render('[w](https://en.wikipedia.org/wiki/Foo_(bar)) ok')
    expect(flattenText(tree.root)).toBe('w ok')
    pressByText(tree, 'w')
    expect(openURL).toHaveBeenLastCalledWith('https://en.wikipedia.org/wiki/Foo_(bar)')
  })

  it('opens a file link whose path has parentheses in it whole', () => {
    const tree = render('see [notes](docs/a_(b).md) now')
    expect(flattenText(tree.root)).toBe('see notes now')
    pressByText(tree, 'notes')
    expect(onOpenFile).toHaveBeenCalledWith('docs/a_(b).md')
  })

  it('keeps a link whose address never closes its parenthesis as the text it is', () => {
    const tree = render('[w](docs/a_(b.md')
    expect(flattenText(tree.root)).toBe('[w](docs/a_(b.md')
    expect(pressables(tree).map(flattenText)).not.toContain('w')
  })

  it('draws a README badge as one link to its target, labelled with the badge words', () => {
    const tree = render('[![CI](https://img.shields.io/b.svg)](https://github.com/x/y)')
    expect(flattenText(tree.root)).toBe('CI')
    expect(pressables(tree).map(flattenText)).toEqual(['CI'])
    pressByText(tree, 'CI')
    expect(openURL).toHaveBeenLastCalledWith('https://github.com/x/y')
  })

  it('draws a row of badges as one link each', () => {
    const tree = render('[![CI](https://a.dev/ci.svg)](https://x.dev/ci) [![npm](https://a.dev/n.svg)](https://x.dev/n)')
    expect(flattenText(tree.root)).toBe('CI npm')
    expect(pressables(tree).map(flattenText)).toEqual(['CI', 'npm'])
    pressByText(tree, 'npm')
    expect(openURL).toHaveBeenLastCalledWith('https://x.dev/n')
  })

  it('labels a badge with no words the way an image with no words is drawn', () => {
    const tree = render('[![](https://a.dev/b.svg)](https://x.dev/y)')
    expect(pressables(tree).map(flattenText)).toEqual(['image'])
  })

  it('still draws the badge image as a link when the link around it never closes', () => {
    const tree = render('[![CI](https://a.dev/b.svg)] and more')
    expect(flattenText(tree.root)).toBe('[CI] and more')
    pressByText(tree, 'CI')
    expect(openURL).toHaveBeenLastCalledWith('https://a.dev/b.svg')
  })

  it('draws an address in angle brackets without them, and opens it without the closing one', () => {
    const tree = render('see <https://x.dev/a>, then')
    expect(flattenText(tree.root)).toBe('see https://x.dev/a, then')
    expect(pressables(tree).map(flattenText)).toEqual(['https://x.dev/a'])
    pressByText(tree, 'https://x.dev/a')
    expect(openURL).toHaveBeenLastCalledWith('https://x.dev/a')
  })

  it('keeps the punctuation an angle-bracket address ends with, which a bare one would drop', () => {
    const tree = render('<https://x.dev/a.>')
    pressByText(tree, 'https://x.dev/a.')
    expect(openURL).toHaveBeenLastCalledWith('https://x.dev/a.')
  })

  // Found in the same sweep: `<a@b.c>` was dropped by the HTML pass as an
  // `<a>` tag, and `<img@x.dev>` drawn as the word "image".
  it('draws an email address in angle brackets as a link that writes to it', () => {
    const tree = render('mail <a@b.c> or <img@x.dev> now')
    expect(flattenText(tree.root)).toBe('mail a@b.c or img@x.dev now')
    expect(pressables(tree).map(flattenText)).toEqual(['a@b.c', 'img@x.dev'])
    pressByText(tree, 'a@b.c')
    expect(openURL).toHaveBeenLastCalledWith('mailto:a@b.c')
  })

  it('draws a mailto address in angle brackets as a link, and one it does not open as written', () => {
    const tree = render('see <mailto:a@b.c> and <ftp://x.dev/a>')
    expect(flattenText(tree.root)).toBe('see mailto:a@b.c and <ftp://x.dev/a>')
    pressByText(tree, 'mailto:a@b.c')
    expect(openURL).toHaveBeenLastCalledWith('mailto:a@b.c')
  })

  it('never opens an address with a closing angle bracket on it', () => {
    const tree = render('an unopened https://x.dev/a> here')
    pressByText(tree, 'https://x.dev/a')
    expect(openURL).toHaveBeenLastCalledWith('https://x.dev/a')
    expect(flattenText(tree.root)).toBe('an unopened https://x.dev/a> here')
  })
})
