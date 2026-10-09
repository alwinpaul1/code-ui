import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fontFamily } from '../theme/tokens'
import { MobileMarkdown } from './MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import { codePillWidth } from './mobile-markdown-code-chip-split'

// 2026-10-09, the user, beside two screenshots of the Claude app's transcript:
// "we can't see most of the content". The Claude app sets its paragraphs
// about 7 dp apart and its bullets about 4, with a wrapped bullet hanging
// under its words; ours put a whole blank 25 dp line between paragraphs.
// Android draws the transcript with no inline selection (Orca #22871), so
// nothing needs a run of prose to be one Text there.
vi.mock('react-native', () => ({
  Image: Object.assign(() => null, { getSize: () => undefined }),
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
  'First paragraph with `code` in it.',
  '',
  'Second paragraph.',
  '',
  '- **Wide pane:** every tab gets the ring.',
  '- Narrow pane: no ring.',
  '',
  '## Section'
].join('\n')

type Style = Record<string, unknown>

function flat(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat)) as Style
  }
  return (style as Style | null | undefined) ?? {}
}

/** The words a Text draws, its nested spans included, pills left out. */
function words(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  if (String(node.type) === 'View') {
    return ''
  }
  return node.children.map(words).join('')
}

describe('MobileMarkdown in the chat transcript', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: Parameters<typeof MobileMarkdown>[0]): ReactTestInstance {
    act(() => {
      renderer = create(createElement(MobileMarkdown, props))
    })
    return renderer!.root
  }

  /** Texts that hold no other Text: the blocks, not their spans. */
  function blockTexts(root: ReactTestInstance): ReactTestInstance[] {
    const texts = root.findAll((node) => String(node.type) === 'Text')
    return texts.filter((node) => !texts.some((other) => other !== node && isAncestor(other, node)))
  }

  function isAncestor(maybe: ReactTestInstance, node: ReactTestInstance): boolean {
    for (let at = node.parent; at; at = at.parent) {
      if (at === maybe) {
        return true
      }
    }
    return false
  }

  it('sets each paragraph, bullet and heading apart by a Claude-sized gap, not a blank line', () => {
    const root = render({ content: CONTENT, rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const blocks = blockTexts(root).map((node) => words(node).trim()).filter((text) => text.length > 0)
    expect(blocks).toContain('First paragraph with  in it.')
    expect(blocks).toContain('Second paragraph.')
    expect(blocks).toContain('Section')
    // No block carries a blank line any more.
    for (const text of blocks) {
      expect(text).not.toContain('\n\n')
    }
    // The document's blocks sit 7 dp apart.
    const document = root.findAll((node) => String(node.type) === 'View' && node.props.collapsable === false)[0]!
    expect(flat(document.props.style).gap).toBe(7)
  })

  it('hangs a wrapped bullet under its words, the bullets 4 dp apart', () => {
    const root = render({ content: CONTENT, rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const item = blockTexts(root).find((node) => words(node).includes('Narrow pane'))!
    // The words are a Text of their own beside the marker, so a second line
    // starts under the words, not under the bullet.
    expect(words(item)).toBe('Narrow pane: no ring.')
    const row = item.parent!
    expect(flat(row.props.style).flexDirection).toBe('row')
    const marker = row.findAll((node) => String(node.type) === 'Text' && node !== item && !isAncestor(item, node))[0]!
    expect(words(marker).trim()).toBe('•')
    const list = row.parent!
    expect(flat(list.props.style).gap).toBe(4)
    // The bold lead-in is still bold.
    const lead = blockTexts(root).find((node) => words(node).includes('Wide pane'))!
    const bold = lead.findAll((node) => String(node.type) === 'Text' && words(node) === 'Wide pane:')
    expect(bold.length).toBeGreaterThan(0)
  })

  it('draws the prose at 14 on 21 and its pill in JetBrains Mono', () => {
    const root = render({ content: CONTENT, rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const paragraph = blockTexts(root).find((node) => words(node).startsWith('Second'))!
    expect(flat(paragraph.props.style)).toMatchObject({ fontSize: 14, lineHeight: 21 })
    const pill = root.findAll((node) => String(node.type) === 'Text' && words(node) === 'code')[0]!
    expect(flat(pill.props.style).fontFamily).toBe(fontFamily.mono)
    expect(flat(pill.props.style).fontSize).toBe(12)
  })

  it('follows the pinch zoom from the transcript’s own size', () => {
    const root = render({ content: CONTENT, rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.5 })
    const paragraph = blockTexts(root).find((node) => words(node).startsWith('Second'))!
    expect(flat(paragraph.props.style)).toMatchObject({ fontSize: 21, lineHeight: 21 * 1.5 + 2 })
    const pill = root.findAll((node) => String(node.type) === 'Text' && words(node) === 'code')[0]!
    expect(flat(pill.props.style)).toMatchObject({ fontSize: 18, lineHeight: 21 })
  })

  // Review of the change, 2026-10-09: each row sized its marker column from
  // its own number, so the words of item 10 started a mono advance right of
  // item 9's, and the column was sized at the zoomed size while the marker
  // was drawn at its own, too narrow for "10." in a thought at the smallest
  // zoom (0.93 × 0.8).
  it('keeps a numbered list’s words in one column, 9 beside 10, and a marker that fits at the smallest zoom', () => {
    const root = render({ content: '9. nine\n10. ten', rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 0.744 })
    const markers = root.findAll((node) => String(node.type) === 'Text' && /^\d+\.$/.test(words(node)))
    expect(markers.map((node) => words(node))).toEqual(['9.', '10.'])
    const widths = markers.map((node) => Number(flat(node.props.style).width))
    expect(widths[0]).toBe(widths[1])
    const size = Number(flat(markers[1]!.props.style).fontSize)
    expect(widths[1]).toBeGreaterThanOrEqual(3 * 0.6 * size)
  })

  // The same review: an item's line width moved with every pinch step, and a
  // Text whose width moves is keyed anew (use-markdown-code-pill-runs.ts
  // keyFor), so every list item remounted, pills and all, as the reader
  // pinched — what a table cell's key once did (review of c3e62696).
  it('keeps each list item mounted across a pinch step', () => {
    const root = render({ content: '- one `pill` here\n- two', rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const documentView = root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    act(() => documentView.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } }))
    const keyOf = () => {
      const item = blockTexts(renderer!.root).find((node) => words(node).startsWith('one'))!
      return (item as unknown as { _fiber: { key: string | null } })._fiber.key
    }
    const before = keyOf()
    act(() => {
      renderer!.update(createElement(MobileMarkdown, { content: '- one `pill` here\n- two', rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.05 }))
    })
    expect(keyOf()).toBe(before)
  })

  // The same review: a transcript table's columns were priced with the cell's
  // face, Instrument Sans at 12, while its pills draw in JetBrains Mono at 11,
  // so a column sized for one path pill cut it in two.
  it('sizes a table column for the mono pill it holds', () => {
    const span = 'src/components/MobileMarkdown.tsx'
    const root = render({ content: `| File |\n| - |\n| \`${span}\` |`, rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const cell = root.findAll((node) => String(node.type) === 'Text' && typeof flat(node.props.style).width === 'number')[1]!
    const style = flat(cell.props.style)
    const inner = Number(style.width) - 2 * Number(style.paddingHorizontal) - Number(style.borderRightWidth)
    expect(inner).toBeGreaterThanOrEqual(codePillWidth(span, { fontSize: 11, insets: 10, mono: true }) + 1)
  })

  it('draws a one-line document and an empty one', () => {
    const one = render({ content: 'Only.', rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    expect(blockTexts(one).map((node) => words(node))).toEqual(['Only.'])
    act(() => renderer?.unmount())
    renderer = null
    const none = render({ content: '', rangeSelectable: true, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    expect(none.findAll((node) => String(node.type) === 'Text')).toHaveLength(0)
  })
})

describe('MobileMarkdown everywhere else', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps a run of prose one Text at 15 on 25, its blocks a blank line apart', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: CONTENT }))
    })
    const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
    const run = texts.find((node) => words(node).includes('First paragraph') && words(node).includes('Second paragraph'))
    expect(run).toBeDefined()
    expect(words(run!)).toContain('\n\n')
    expect(flat(run!.props.style)).toMatchObject({ fontSize: 15, lineHeight: 25 })
    const pill = texts.find((node) => words(node) === 'code')!
    expect(flat(pill.props.style).fontFamily).toBe(fontFamily.regular)
  })

  it('keeps the blank line in a transcript that can be selected (iOS), where one Text lets a selection cross', () => {
    // Android is mocked here, so only `rangeSelectable` without the
    // transcript type stands in for a selectable surface.
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: CONTENT, rangeSelectable: false, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    })
    const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
    const run = texts.find((node) => words(node).includes('First paragraph') && words(node).includes('Second paragraph'))
    expect(run).toBeDefined()
    expect(flat(run!.props.style)).toMatchObject({ fontSize: 14, lineHeight: 21 })
  })
})
