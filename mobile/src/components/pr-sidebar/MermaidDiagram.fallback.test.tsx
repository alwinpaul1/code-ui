// The native diagram's failure path: a posted error, onError, onHttpError and a navigation away
// each replace the WebView with the labelled source box, so a diagram that cannot render never
// blanks the chat. Written by the batch D review (2026-09-23); the fork had no test of these.
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))

import { MermaidDiagram } from './MermaidDiagram'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  renderer?.unmount()
  renderer = undefined
})

const SOURCE = 'graph TD; A-->'
function mount() {
  act(() => {
    renderer = create(createElement(MermaidDiagram, { source: SOURCE, base: 14 }))
  })
  return renderer!
}
function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType('Text' as never).map((node) => String(node.props.children))
}

describe('native MermaidDiagram failure path', () => {
  it('renders the WebView with the built document first', () => {
    const tree = mount()
    const webview = tree.root.findByType('WebView' as never)
    expect(webview.props.source.html).toContain('mermaid.initialize(')
    expect(webview.props.source.html).toContain('"suppressErrorRendering":true')
  })

  for (const [name, fire] of Object.entries({
    "posted 'error'": (w: ReactTestInstance) => w.props.onMessage({ nativeEvent: { data: 'error' } }),
    onError: (w: ReactTestInstance) => w.props.onError({ nativeEvent: {} }),
    onHttpError: (w: ReactTestInstance) => w.props.onHttpError({ nativeEvent: {} }),
    'a navigation away': (w: ReactTestInstance) => w.props.onShouldStartLoadWithRequest({ url: 'https://evil.example/' })
  })) {
    it(`shows the source box after ${name}`, () => {
      const tree = mount()
      act(() => {
        fire(tree.root.findByType('WebView' as never))
      })
      expect(tree.root.findAllByType('WebView' as never)).toHaveLength(0)
      expect(texts(tree)).toEqual(['mermaid', SOURCE])
    })
  }

  it('sizes to a posted height and keeps the WebView', () => {
    const tree = mount()
    act(() => {
      tree.root.findByType('WebView' as never).props.onMessage({ nativeEvent: { data: '321.4' } })
    })
    const webview = tree.root.findByType('WebView' as never)
    expect(webview.props.style[1]).toEqual({ height: 322 })
  })
})
