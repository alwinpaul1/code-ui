import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
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

// One document carrying every block the agent writes that a reader would want
// to lift verbatim — a command out of a fence, a cell out of a table.
const DOCUMENT = [
  '## What changed',
  '',
  'Two safety details. First, the total cannot go below zero.',
  '',
  '> The lock file resolves differently in the image.',
  '',
  '```sh',
  'pnpm install --frozen-lockfile',
  '```',
  '',
  '| Stage | Resolver |',
  '| --- | --- |',
  '| base | pip |',
  '',
  '- run the suite inside the image'
].join('\n')

describe('agent prose the reader wants to copy', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function textsBySelectability(): { selectable: string[]; fixed: string[] } {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: DOCUMENT }))
    })
    const selectable: string[] = []
    const fixed: string[] = []
    for (const node of renderer!.root.findAllByType('Text' as never)) {
      const text = node.children
        .map((child) => (typeof child === 'string' ? child : ''))
        .join('')
        .trim()
      if (!text) {
        continue
      }
      ;(node.props.selectable === true ? selectable : fixed).push(text)
    }
    return { selectable, fixed }
  }

  it('lets the reader select a paragraph — the answer itself, not only its table', () => {
    // Why: reported 2026-09-11 from a tablet with a video — a long press on
    // an answer's prose selected nothing while its table did. Every other
    // block was selectable; the paragraph was the one left out.
    const { selectable, fixed } = textsBySelectability()
    expect(selectable.some((text) => text.includes('Two safety details'))).toBe(true)
    expect(fixed.some((text) => text.includes('Two safety details'))).toBe(false)
  })

  it('lets the reader select a heading, a quote, a fence, a table cell and a list item', () => {
    const { selectable } = textsBySelectability()
    expect(selectable).toContain('What changed')
    expect(selectable).toContain('The lock file resolves differently in the image.')
    expect(selectable).toContain('pnpm install --frozen-lockfile')
    expect(selectable).toContain('Stage')
    expect(selectable).toContain('base')
    expect(selectable).toContain('run the suite inside the image')
  })
})
