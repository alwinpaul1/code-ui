import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fontFamily } from '../theme/tokens'
import { MobileMarkdown } from './MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import { codePillWidth } from './mobile-markdown-code-chip-split'

// 2026-10-09, the user, beside two screenshots of the Claude app's transcript:
// "we can't see most of the content". The Claude app sets its paragraphs
// about 7 dp apart; ours put a whole blank 25 dp line between paragraphs.
//
// The same day the user asked for the fork's own hold-to-copy back (Orca
// #22871 reverted): a long press in a reply starts Android's selection and
// its handles drag across words, lines, paragraphs and list items. That needs
// a run of prose to stay ONE selectable Text, so the 7 dp gap is the height
// of the blank line inside it, not a gap between Texts.
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
// Android as Metro resolves it: each pill's View carries the span a Copy
// puts in place of its U+FFFC (markdown-selection-copy.android.tsx).
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./markdown-selection-copy', () => import('./markdown-selection-copy.android'))

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

/**
 * What Android's selection puts on the clipboard for the whole Text: the
 * characters it draws, with each code pill's U+FFFC swapped for the span on
 * its nativeID, once per span (markdown-pill-copy-id.ts, PillCopy.kt). Not
 * the Markdown source.
 */
function copied(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  if (String(node.type) === 'View') {
    const id: unknown = node.props.nativeID
    const pill = typeof id === 'string' ? /^codeui-pill:(\d+):([\s\S]+)$/.exec(id) : null
    if (pill) {
      return pill[1] === '0' ? pill[2]! : ''
    }
    return ''
  }
  return node.children.map(copied).join('')
}

function isAncestor(maybe: ReactTestInstance, node: ReactTestInstance): boolean {
  for (let at = node.parent; at; at = at.parent) {
    if (at === maybe) {
      return true
    }
  }
  return false
}

/** Texts that hold no other Text: the blocks, not their spans. */
function blockTexts(root: ReactTestInstance): ReactTestInstance[] {
  const texts = root.findAll((node) => String(node.type) === 'Text')
  return texts.filter((node) => !texts.some((other) => other !== node && isAncestor(other, node)))
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

  it('lets one long press drag across paragraphs, bullets and a heading: the reply is one selectable Text', () => {
    const root = render({ content: CONTENT, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const blocks = blockTexts(root)
    expect(blocks).toHaveLength(1)
    const run = blocks[0]!
    expect(run.props.selectable).toBe(true)
    expect(words(run)).toBe(
      'First paragraph with  in it.\n\nSecond paragraph.\n\n•  Wide pane: every tab gets the ring.\n•  Narrow pane: no ring.\n\nSection'
    )
    // No selection handle can stop at a nested Text: none of them is
    // selectable on its own, they are spans of the run.
    const nested = root.findAll((node) => String(node.type) === 'Text' && node !== run && isAncestor(run, node) && words(node) !== 'code')
    expect(nested.length).toBeGreaterThan(0)
    for (const span of nested) {
      expect(span.props.selectable).toBeUndefined()
    }
  })

  it('sets the blocks a Claude-sized 7 dp apart: the blank line between them is 7 dp tall', () => {
    const root = render({ content: CONTENT, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const run = blockTexts(root)[0]!
    const gaps = run.findAll((node) => String(node.type) === 'Text' && words(node) === '\n' && node.children.length === 1)
    // Between paragraph 1 and 2, 2 and the list, the list and the heading.
    expect(gaps.map((gap) => flat(gap.props.style).lineHeight)).toEqual([7, 7, 7])
    // At a pinch the gap grows with the type.
    act(() => {
      renderer!.update(createElement(MobileMarkdown, { content: CONTENT, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.5 }))
    })
    const zoomed = blockTexts(renderer!.root)[0]!.findAll(
      (node) => String(node.type) === 'Text' && words(node) === '\n' && node.children.length === 1
    )
    expect(zoomed.map((gap) => flat(gap.props.style).lineHeight)).toEqual([10.5, 10.5, 10.5])
  })

  // 2026-10-09, the user: a copied selection must read as the reply reads,
  // with no Markdown markup in it. Android copies what the Text draws.
  it('copies a reply as its words, with no stars, hashes, backticks, source list markers or link syntax', () => {
    const reply = [
      '## Next steps',
      '',
      'Run **the gate** with *care* and `pnpm test` first.',
      '',
      '* one item',
      '* second, see [the docs](https://example.com/docs)'
    ].join('\n')
    const root = render({ content: reply, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, onOpenFile: () => {} })
    const blocks = blockTexts(root)
    expect(blocks).toHaveLength(1)
    expect(copied(blocks[0]!)).toBe(
      'Next steps\n\nRun the gate with care and pnpm test first.\n\n•  one item\n•  second, see the docs'
    )
  })

  it('draws the prose at 14 on 21 and its pill in JetBrains Mono', () => {
    const root = render({ content: CONTENT, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const run = blockTexts(root)[0]!
    expect(flat(run.props.style)).toMatchObject({ fontSize: 14, lineHeight: 21 })
    const pill = root.findAll((node) => String(node.type) === 'Text' && words(node) === 'code')[0]!
    expect(flat(pill.props.style).fontFamily).toBe(fontFamily.mono)
    expect(flat(pill.props.style).fontSize).toBe(12)
  })

  it('follows the pinch zoom from the transcript’s own size', () => {
    const root = render({ content: CONTENT, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.5 })
    const run = blockTexts(root)[0]!
    expect(flat(run.props.style)).toMatchObject({ fontSize: 21, lineHeight: 21 * 1.5 + 2 })
    const pill = root.findAll((node) => String(node.type) === 'Text' && words(node) === 'code')[0]!
    expect(flat(pill.props.style)).toMatchObject({ fontSize: 18, lineHeight: 21 })
  })

  it('keeps the reply’s Text mounted across a pinch step', () => {
    const root = render({ content: '- one `pill` here\n- two', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const documentView = root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    act(() => documentView.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } }))
    const keyOf = () => {
      const run = blockTexts(renderer!.root)[0]!
      return (run as unknown as { _fiber: { key: string | null } })._fiber.key
    }
    const before = keyOf()
    act(() => {
      renderer!.update(createElement(MobileMarkdown, { content: '- one `pill` here\n- two', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.05 }))
    })
    expect(keyOf()).toBe(before)
  })

  // Review of the typography change: a transcript table's columns were priced
  // with the cell's face, Instrument Sans at 12, while its pills draw in
  // JetBrains Mono at 11, so a column sized for one path pill cut it in two.
  it('sizes a table column for the mono pill it holds', () => {
    const span = 'src/components/MobileMarkdown.tsx'
    const root = render({ content: `| File |\n| - |\n| \`${span}\` |`, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    const cell = root.findAll((node) => String(node.type) === 'Text' && typeof flat(node.props.style).width === 'number')[1]!
    const style = flat(cell.props.style)
    const inner = Number(style.width) - 2 * Number(style.paddingHorizontal) - Number(style.borderRightWidth)
    expect(inner).toBeGreaterThanOrEqual(codePillWidth(span, { fontSize: 11, insets: 10, mono: true }) + 1)
  })

  it('draws a one-line document with no gap line, and an empty one with nothing', () => {
    const one = render({ content: 'Only.', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    expect(blockTexts(one).map((node) => words(node))).toEqual(['Only.'])
    expect(one.findAll((node) => String(node.type) === 'Text')).toHaveLength(1)
    act(() => renderer?.unmount())
    renderer = null
    const none = render({ content: '', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
    expect(none.findAll((node) => String(node.type) === 'Text')).toHaveLength(0)
  })
})

describe('MobileMarkdown everywhere else', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps a run of prose one Text at 15 on 25, its blocks a whole prose line apart', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: CONTENT }))
    })
    const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
    const run = texts.find((node) => words(node).includes('First paragraph') && words(node).includes('Second paragraph'))
    expect(run).toBeDefined()
    expect(words(run!)).toContain('\n\n')
    expect(flat(run!.props.style)).toMatchObject({ fontSize: 15, lineHeight: 25 })
    // The blank line is the run's own, at the prose line height: no gap span.
    expect(run!.findAll((node) => String(node.type) === 'Text' && words(node) === '\n' && node.children.length === 1)).toHaveLength(0)
    const pill = texts.find((node) => words(node) === 'code')!
    expect(flat(pill.props.style).fontFamily).toBe(fontFamily.regular)
  })
})
