import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatVisualDirective } from '../../../src/shared/native-chat-visual-directive'
import { MobileMarkdown } from './MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'

// Orca #26071 on this fork: on Android a reply's prose runs are native TextViews
// (modules/orca-native-prose), so an inline chat visual (a WebView) cannot sit inside a run. It
// must end the run before it and start a new one after it, drawn between them as its own block.

vi.mock('react-native', () => ({
  Image: Object.assign(() => null, { getSize: () => undefined }),
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: () => 1
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'OrcaNativeProse' ? { measure: () => 300 } : null,
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./native-prose-text', () => import('./native-prose-text.android'))

const NATIVE = 'ViewManagerAdapter_OrcaNativeProse'

const REPLY = [
  'Here is usage by day.',
  '::orca-visual{file="usage-3f2a.html" title="Usage by day"}',
  'Sunday dips.'
].join('\n')

const drawn: NativeChatVisualDirective[] = []
function renderVisual(directive: NativeChatVisualDirective, index: number): ReactElement {
  drawn.push(directive)
  return createElement('Visual', { file: directive.file, index })
}

describe('a chat visual between native prose runs', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    drawn.length = 0
  })

  function render(element: ReactElement): ReactTestInstance {
    act(() => {
      renderer = create(element)
    })
    const root = renderer!.root
    const document = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function')
    act(() => {
      document.props.onLayout({ nativeEvent: { layout: { width: 380, height: 0, x: 0, y: 0 } } })
    })
    return root
  }

  /** The document's drawn children in order: a native run, a visual, or anything else. */
  function order(root: ReactTestInstance): string[] {
    const document = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function')
    return document
      .findAll((node) => String(node.type) === NATIVE || String(node.type) === 'Visual')
      .map((node) =>
        String(node.type) === 'Visual'
          ? `visual:${String(node.props.file)}`
          : `prose:${String(JSON.parse(node.props.spec as string).model.text)}`
      )
  }

  it('ends the run before it and starts a new one after it', () => {
    const root = render(
      createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, renderVisual })
    )
    expect(order(root)).toEqual([
      'prose:Here is usage by day.',
      'visual:usage-3f2a.html',
      'prose:Sunday dips.'
    ])
    // The title reaches the renderer as written; a re-render after layout asks again.
    expect(drawn.at(-1)).toEqual({ file: 'usage-3f2a.html', title: 'Usage by day' })
  })

  it('leaves the directive line as prose on a surface that draws no visuals', () => {
    const root = render(createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    const runs = order(root)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toContain('::orca-visual{file="usage-3f2a.html" title="Usage by day"}')
    expect(drawn).toEqual([])
  })

  it('draws a reply that is only a visual as the visual alone', () => {
    const root = render(
      createElement(MobileMarkdown, {
        content: '::orca-visual{file="only.html"}',
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        renderVisual
      })
    )
    expect(order(root)).toEqual(['visual:only.html'])
  })
})
