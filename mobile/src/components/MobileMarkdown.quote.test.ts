import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, flatten: (style: unknown) => style },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// 2026-09-24, from the phone: a letter the agent drafted, quoted paragraph by
// paragraph with blank `>` lines between, drew as a bar stub on each
// paragraph's first line, a lone bar on each blank line, and wrapped lines with
// no bar at all. The Claude app draws one bar down the whole quote with the
// text indented beside it. The shape is the agent's; the words are not.
const LETTER = [
  'The draft is ready and has not been sent:',
  '',
  '> Hi Sam,',
  '>',
  '> I found an error in the energy model, and it changes the main result. I want to discuss it with you before I change anything.',
  '>',
  '> The fidelity score and the measured energy do not change.',
  '',
  'Tell me if you want any changes.'
].join('\n')

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

describe('a quote of several paragraphs', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('draws as one block with one bar down its whole height, the way the Claude app does', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: LETTER }))
    })
    const quotes = renderer!.root.findAll(
      (node) => node.type === ('View' as never) && JSON.stringify(node.props.style ?? '').includes('borderLeftWidth')
    )
    expect(quotes).toHaveLength(1)
    const quoted = textOf(quotes[0]!)
    expect(quoted).toContain('Hi Sam,')
    expect(quoted).toContain('I found an error in the energy model')
    expect(quoted).toContain('The fidelity score and the measured energy do not change.')
    expect(quoted).not.toContain('Tell me if you want')
    // No bar drawn as text: that is the glyph that stubbed each line.
    expect(textOf(renderer!.root)).not.toContain('▎')
  })

  it('keeps the prose around the quote as ordinary paragraphs', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: LETTER }))
    })
    const all = textOf(renderer!.root)
    expect(all.indexOf('The draft is ready')).toBeLessThan(all.indexOf('Hi Sam,'))
    expect(all.indexOf('do not change.')).toBeLessThan(all.indexOf('Tell me if you want'))
  })
})
