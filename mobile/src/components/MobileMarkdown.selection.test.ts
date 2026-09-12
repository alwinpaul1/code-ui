import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { ChatTextSelectableContext } from './chat-text-selectable-context'

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
    // A span nested in a selectable Text is selectable with it.
    const inSelectable = (node: ReactTestInstance | null): boolean =>
      node != null && (node.props.selectable === true || inSelectable(node.parent))
    for (const node of renderer!.root.findAllByType('Text' as never)) {
      const text = node.children
        .map((child) => (typeof child === 'string' ? child : ''))
        .join('')
        .trim()
      if (!text) {
        continue
      }
      ;(inSelectable(node) ? selectable : fixed).push(text)
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

  it('lets one selection span neighbouring paragraphs and their heading', () => {
    // Why: Android confines a selection to one Text; with a Text per
    // paragraph the reader could select a paragraph but never the next one
    // (2026-09-12, screenshot). Consecutive prose is one selectable Text.
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: ['## Cause', '', 'First paragraph here.', '', 'Second paragraph here.'].join('\n')
        })
      )
    })
    const selectableTexts = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
    expect(selectableTexts).toHaveLength(1)
    const flat = selectableTexts[0]!
      .findAll(() => true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
      .join('')
    expect(flat).toContain('Cause')
    expect(flat).toContain('First paragraph here.')
    expect(flat).toContain('Second paragraph here.')
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

// 2026-09-12: random buzzes while scrolling. Android arms a text-selection
// long-press under any selectable Text; a finger put down to stop a fling and
// held tripped it. The chat view turns selection off while a scroll is in
// flight, through this context, and back on when it settles.
describe('while the list is scrolling', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function selectableTexts(value: boolean): { all: number; selectable: number } {
    act(() => {
      renderer = create(
        createElement(
          ChatTextSelectableContext.Provider,
          { value },
          createElement(MobileMarkdown, { content: DOCUMENT })
        )
      )
    })
    const texts = renderer!.root.findAllByType('Text' as never)
    return { all: texts.length, selectable: texts.filter((node) => node.props.selectable === true).length }
  }

  it('renders no selectable text, so a finger stopping a fling arms no long-press', () => {
    const { all, selectable } = selectableTexts(false)
    expect(all).toBeGreaterThan(5)
    expect(selectable).toBe(0)
  })

  it('is selectable again once the scroll settles', () => {
    expect(selectableTexts(true).selectable).toBeGreaterThan(0)
  })
})
