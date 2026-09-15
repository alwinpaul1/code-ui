import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
// Why: lucide, the WebView preview, the PDF view and the highlighter all reach
// for React Native internals the host-tag mock above removed. The routing
// decision is what is under test.
vi.mock('lucide-react-native', () => ({
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Send: 'Send'
}))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('../files/MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('../components/MobileSyntaxSegments', () => ({
  MobileSyntaxLine: 'MobileSyntaxLine',
  MobileSyntaxSegments: 'MobileSyntaxSegments'
}))
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('./mobile-session-styles', () => ({ styles: {} }))
vi.mock('./mobile-file-syntax', () => ({
  buildPlainMobileDiffSyntaxLines: () => [],
  highlightMobileCode: () => ({ segments: [] }),
  highlightMobileDiffLines: () => [],
  resolveMobileSyntaxLanguage: () => 'markdown'
}))
vi.mock('../files/MobileFileMarkdownPreview', () => ({
  MobileFileMarkdownPreview: 'MobileFileMarkdownPreview'
}))

import { FileReader } from './MobileSessionFileReader'

function renderMarkdownTab(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(FileReader, {
        doc: {
          status: 'ready',
          kind: 'markdown',
          content: '# Rules',
          truncated: true,
          byteLength: 400_000
        },
        title: 'CLAUDE.md',
        relativePath: 'CLAUDE.md'
      })
    )
  })
  if (!renderer) {
    throw new Error('FileReader did not render')
  }
  return renderer
}

describe('opening a markdown file tab on the phone', () => {
  // Why: the fork grew a second, hand-rolled markdown preview beside the ported
  // one. Two viewers of the same file drift apart; the file tab must reach the
  // ported component, and only that one.
  it('renders the file as a document through the ported preview', () => {
    const renderer = renderMarkdownTab()
    const preview = renderer.root.findByType('MobileFileMarkdownPreview' as never)
    expect(preview.props.content).toBe('# Rules')
    expect(preview.props.relativePath).toBe('CLAUDE.md')
    renderer.unmount()
  })

  // Why: a rendered document hides where the text stops, so the host's
  // truncation facts have to reach the preview that draws the note.
  it('hands the preview the truncation facts, so a cut-off file says so', () => {
    const renderer = renderMarkdownTab()
    const preview = renderer.root.findByType('MobileFileMarkdownPreview' as never)
    expect(preview.props.truncated).toBe(true)
    expect(preview.props.byteLength).toBe(400_000)
    renderer.unmount()
  })

  // Why: source stays the reader's own numbered, virtualized view — one <Text>
  // for the whole file froze the UI on a 4000-line file (2026-09-13).
  it("lends the preview the reader's own numbered source view", () => {
    const renderer = renderMarkdownTab()
    const preview = renderer.root.findByType('MobileFileMarkdownPreview' as never)
    expect(typeof preview.props.renderSource).toBe('function')
    renderer.unmount()
  })
})
