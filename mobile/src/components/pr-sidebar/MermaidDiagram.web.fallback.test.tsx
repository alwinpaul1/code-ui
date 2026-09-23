// The page diagram's failure path: an engine artifact that fails to import, an initialize that
// throws and a render that rejects each show the source; a success draws the SVG. Written by the
// batch D review (2026-09-23); the fork had no test for MermaidDiagram.web.tsx at all.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
const loader = vi.hoisted(() => ({ load: (): Promise<unknown> => Promise.reject(new Error('unset')) }))
vi.mock('./mermaid-page-engine', () => ({ loadPageMermaid: () => loader.load() }))

import { MermaidDiagram } from './MermaidDiagram.web'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

const SOURCE = 'graph TD; A-->B'
async function mount() {
  const host = { innerHTML: '', replaceChildren: vi.fn() }
  await act(async () => {
    renderer = create(createElement(MermaidDiagram, { source: SOURCE, base: 14 }), {
      createNodeMock: () => host
    })
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { tree: renderer!, host }
}
const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType('Text' as never).map((n) => String(n.props.children))

describe('page MermaidDiagram failure path', () => {
  it('shows the source when the engine artifact fails to import', async () => {
    loader.load = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
    const { tree } = await mount()
    expect(texts(tree)).toEqual(['mermaid', SOURCE])
  })

  it('shows the source when the engine throws on initialize', async () => {
    loader.load = async () => ({ initialize: () => { throw new Error('bad engine') }, render: vi.fn() })
    const { tree } = await mount()
    expect(texts(tree)).toEqual(['mermaid', SOURCE])
  })

  it('shows the source when render rejects', async () => {
    loader.load = async () => ({ initialize: vi.fn(), render: () => Promise.reject(new Error('parse')) })
    const { tree } = await mount()
    expect(texts(tree)).toEqual(['mermaid', SOURCE])
  })

  it('draws the svg into the host on success', async () => {
    loader.load = async () => ({ initialize: vi.fn(), render: async () => ({ svg: '<svg id="ok"></svg>' }) })
    const { tree, host } = await mount()
    expect(host.innerHTML).toBe('<svg id="ok"></svg>')
    expect(texts(tree)).toEqual(['mermaid'])
  })
})
