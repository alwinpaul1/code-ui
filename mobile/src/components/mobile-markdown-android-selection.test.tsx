import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { MobileMarkdownImage } from './MobileMarkdownImage'

// Orca #22871. Why Android here: on Android every paragraph, heading, quote,
// fence and table cell in the chat transcript was a selectable TextView, and
// two flicks in the same spot while scrolling the list register as a double
// tap, which selects a word. This proves the transcript carries no selectable
// span on Android, that a long press on anything tappable reaches the row's
// actions sheet, and that other surfaces are untouched.
vi.mock('react-native', () => ({
  // A host element that measures a remote image at once, so a figure draws as its Pressable.
  Image: Object.assign(() => null, {
    getSize: (_url: string, ok: (width: number, height: number) => void) => ok(400, 200)
  }),
  Linking: { openURL: () => Promise.resolve() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

const CONTENT = [
  '# Heading',
  'A paragraph with **bold**, `code` and https://example.com/link.',
  '> quoted',
  '- item one',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '```',
  'fenced()',
  '```'
].join('\n')

describe('MobileMarkdown on Android', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: Parameters<typeof MobileMarkdown>[0]): ReactTestInstance[] {
    act(() => {
      renderer = create(createElement(MobileMarkdown, props))
    })
    return renderer!.root.findAll((node) => String(node.type) === 'Text')
  }

  const tappable = (nodes: ReactTestInstance[]) =>
    nodes.filter((node) => typeof node.props.onPress === 'function')

  it('renders the transcript with no selectable span, leaving untouched spans alone', () => {
    const all = render({ content: CONTENT, rangeSelectable: true })
    expect(all.length).toBeGreaterThan(5)
    expect(all.filter((node) => node.props.selectable === true)).toHaveLength(0)
    // Inline spans (bold, code, links) never asked for selection; writing `false` onto them
    // would map to `userSelect: none` on the web, so the gate must leave them alone.
    const links = tappable(all)
    expect(links.length).toBeGreaterThan(0)
    for (const node of links) {
      expect(node.props.selectable).toBeUndefined()
    }
  })

  // This fork draws an image that has not loaded (or cannot be read) as a
  // tappable link inside the prose run, and a loaded one as a Pressable;
  // both take the row's long press.
  it('routes a long press on a tappable span or image to the row, so neither swallows it', () => {
    const onLongPress = vi.fn()
    const content = `${CONTENT}\n\n![diagram](https://example.com/diagram.png)\n\nSee \`docs/hud.md\` and mobile/src/a.ts.`
    const all = render({ content, rangeSelectable: true, onLongPress, onOpenFile: () => {} })
    const links = tappable(all)
    const labels = links.map((node) => node.findAll(() => true).flatMap((child) => child.children).filter((c) => typeof c === 'string').join(''))
    // A web link, the image's link, a file pill and a named file.
    expect(labels).toEqual(expect.arrayContaining(['https://example.com/link', 'diagram', 'docs/hud.md', 'mobile/src/a.ts']))
    for (const node of links) {
      expect(node.props.onLongPress).toBe(onLongPress)
    }
    expect(all.filter((node) => !node.props.onPress && node.props.onLongPress)).toHaveLength(0)
  })

  it('routes a long press on a loaded image to the row too', () => {
    const onLongPress = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileMarkdownImage, {
          alt: 'diagram',
          url: 'https://example.com/diagram.png',
          width: 300,
          onOpen: () => {},
          onLongPress,
          styles: { link: {}, imageCaptionInline: {} }
        })
      )
    })
    const [image] = renderer!.root.findAll(
      (node) => String(node.type) === 'Pressable' && typeof node.props.onPress === 'function'
    )
    expect(image).toBeDefined()
    expect(image!.props.onLongPress).toBe(onLongPress)
  })

  it('keeps other surfaces (task comments, previews) selectable as before', () => {
    const all = render({ content: CONTENT })
    expect(all.filter((node) => node.props.selectable === true).length).toBeGreaterThan(0)
  })

  // Off the transcript a hold on a link still does not open it on release
  // (markdown-link-hold.ts): that surface keeps Android's own selection.
  it('keeps the hold-does-not-open guard on links off the transcript', () => {
    const all = render({ content: CONTENT })
    const links = tappable(all)
    expect(links.length).toBeGreaterThan(0)
    for (const node of links) {
      expect(typeof node.props.onLongPress).toBe('function')
    }
  })
})
