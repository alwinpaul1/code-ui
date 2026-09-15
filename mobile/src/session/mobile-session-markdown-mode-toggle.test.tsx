import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
// The WebView editor and the icon set both reach for React Native internals the
// host-tag mock above removes. Which of the two panes is mounted is the subject
// here, so a string tag is enough to tell them apart.
vi.mock('../components/MobileRichMarkdownEditor', () => ({
  MobileRichMarkdownEditor: 'MobileRichMarkdownEditor'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('lucide-react-native', () => ({ Eye: 'Eye', Pencil: 'Pencil', RefreshCw: 'RefreshCw' }))

import { Text } from 'react-native'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { MobileRichMarkdownEditor } from '../components/MobileRichMarkdownEditor'
import { ThemeProvider } from '../theme/theme-context'
import type { MarkdownDocState } from './mobile-session-route-types'

// Asked for on 2026-09-15: "where is the preview and the edit toggle i only
// need 2". The tab opened straight into the WYSIWYG editor, formatting toolbar
// and all, whether or not anyone meant to type.
const DOC: MarkdownDocState = {
  status: 'ready',
  localContent: '# Title\n\nA paragraph that was\nwrapped by its author.',
  editable: true,
  isDirty: false,
  saving: false,
  stale: false
} as MarkdownDocState

function render(preference: 'light' | 'dark' = 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: preference },
        createElement(MarkdownReader, {
          documentId: 'd1',
          doc: DOC,
          onRefresh: () => {},
          onChange: () => {},
          onSave: () => {},
          onCopy: () => {},
          onDiscard: () => {},
          keyboardLift: 0
        })
      )
    )
  })
  return renderer
}

function toggle(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function'
  )[0]!
}

describe('the .md tab’s preview and edit toggle', () => {
  it('offers exactly two modes', () => {
    const renderer = render()
    const labels = renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((child) => child === 'Preview' || child === 'Edit')
    expect(labels).toEqual(['Preview', 'Edit'])
    act(() => renderer.unmount())
  })

  it('opens on the preview, because opening a document is usually reading it', () => {
    const renderer = render()
    expect(renderer.root.findAllByType(MobileMarkdown)).toHaveLength(1)
    expect(renderer.root.findAllByType(MobileRichMarkdownEditor)).toHaveLength(0)
    expect(toggle(renderer, 'Preview Markdown').props.accessibilityState.selected).toBe(true)
    act(() => renderer.unmount())
  })

  it('hands over to the editor on Edit, and back again', () => {
    const renderer = render()
    act(() => toggle(renderer, 'Edit Markdown').props.onPress())
    expect(renderer.root.findAllByType(MobileRichMarkdownEditor)).toHaveLength(1)
    // Only one live copy of the document: two would both answer onChange, and
    // the WebView keeps its own undo stack.
    expect(renderer.root.findAllByType(MobileMarkdown)).toHaveLength(0)
    act(() => toggle(renderer, 'Preview Markdown').props.onPress())
    expect(renderer.root.findAllByType(MobileMarkdown)).toHaveLength(1)
    expect(renderer.root.findAllByType(MobileRichMarkdownEditor)).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('previews the document’s own text', () => {
    const renderer = render()
    expect(renderer.root.findByType(MobileMarkdown).props.content).toBe(DOC.localContent)
    act(() => renderer.unmount())
  })

  it('draws the toggle in each theme, not one hardcoded palette', () => {
    const dark = render('dark')
    const darkBar = toggle(dark, 'Preview Markdown').props.style
    const darkColour = dark.root.findByType(MobileMarkdown)
    expect(darkColour).toBeTruthy()
    act(() => dark.unmount())

    const light = render('light')
    const lightBar = toggle(light, 'Preview Markdown').props.style
    // The selected pill paints from theme tokens, so its background differs
    // between the two. A hardcoded palette would give the same value twice.
    expect(JSON.stringify(lightBar)).not.toBe(JSON.stringify(darkBar))
    act(() => light.unmount())
  })
})
