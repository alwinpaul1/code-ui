import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(content: string): ReactTestRenderer {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content }))
  })
  return renderer!
}

function flatten(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : flatten(child)))
    .join('')
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle))
  }
  return (style ?? {}) as Record<string, unknown>
}

// Verbatim out of this repository's CLAUDE.md, hard-wrapped at 80 columns.
const WRAPPED_LIST = [
  '1. **Write the failing test first**, from the real symptom, in the same commit.',
  '   Run it and watch it fail. A test that passes before the fix is testing',
  '   something else.',
  '2. **Feed it the real screen, not a paraphrase.** Terminal parsers break on',
  '   the exact bytes an agent paints: the indent, the wrap column, the marker',
  '   glyph, the hint wording.'
].join('\n')

describe('an 80-column document read on a phone', () => {
  it('numbers the second item 2., not 1. again', () => {
    const markers = render(WRAPPED_LIST)
      .root.findAllByType('Text' as never)
      .map((node) => flatten(node))
      .map((text) => text.trim())
      .filter((text) => /^\d+\.$/.test(text))
    expect(markers).toEqual(['1.', '2.'])
  })

  it('shows a bold span that crossed a source wrap as bold, not as asterisks', () => {
    const tree = render(
      [
        '**When a figure genuinely cannot be known, show what is known and say the rest',
        'is unknown.** Never invent a denominator.'
      ].join('\n')
    )
    expect(flatten(tree.root)).not.toContain('**')
    // One Text carries the whole bold phrase, reflowed across the source wrap.
    const spans = tree.root.findAllByType('Text' as never).map((node) => flatten(node))
    expect(spans).toContain(
      'When a figure genuinely cannot be known, show what is known and say the rest is unknown.'
    )
  })

  it('indents a nested list item so its level is visible', () => {
    // The list lives inside the prose run as spans (2026-09-19, so a
    // selection can cross it), so the level is leading spaces on the line,
    // and a deeper bullet glyph.
    const tree = render('- outer\n  - inner')
    const run = tree.root
      .findAllByType('Text' as never)
      .find((node) => node.props.selectable === true)!
    const inOrder = (node: ReactTestInstance): string =>
      node.children
        .map((child) => (typeof child === 'string' ? child : inOrder(child)))
        .join('')
    expect(inOrder(run)).toBe('•  outer\n    ◦  inner')
  })

  it('scrolls a code fence sideways rather than wrapping the command', () => {
    // At ~40 columns a wrapped command is a command the reader cannot copy.
    const tree = render('```sh\npnpm install --frozen-lockfile && pnpm test\n```')
    const scroller = tree.root
      .findAllByType('ScrollView' as never)
      .find((node) => flatten(node).includes('pnpm install'))
    expect(scroller, 'the fence body is not inside a horizontal scroller').toBeDefined()
    expect(scroller!.props.horizontal).toBe(true)
  })
})

describe('heading levels on a narrow screen', () => {
  it('sizes h1, h2 and h3 apart so a section boundary is visible', () => {
    const tree = render('# One\n\n## Two\n\n### Three\n\n#### Four')
    const sizes = new Map<string, number>()
    for (const node of tree.root.findAllByType('Text' as never)) {
      const text = flatten(node)
      if (['One', 'Two', 'Three', 'Four'].includes(text)) {
        sizes.set(text, flattenStyle(node.props.style).fontSize as number)
      }
    }
    expect(sizes.get('One')!).toBeGreaterThan(sizes.get('Two')!)
    expect(sizes.get('Two')!).toBeGreaterThan(sizes.get('Three')!)
    expect(sizes.get('Three')!).toBeGreaterThan(sizes.get('Four')!)
  })
})
