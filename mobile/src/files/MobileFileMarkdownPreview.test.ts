import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileFileMarkdownPreview } from './MobileFileMarkdownPreview'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))

vi.mock('lucide-react-native', () => ({
  Code: 'Code',
  Pencil: 'Pencil'
}))

vi.mock('../components/MobileMarkdown', () => ({
  MobileMarkdown: 'MobileMarkdown'
}))

vi.mock('./MobileFilePreviewSourceText', () => ({
  MobileFilePreviewSourceText: 'MobileFilePreviewSourceText',
  MobileFilePreviewTruncatedNote: 'MobileFilePreviewTruncatedNote'
}))

// Why: the mode machine is what is under test here; the live palette has its own
// test (mobile-file-markdown-preview-theme).
vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({ colors: { text: '#fff', textSecondary: '#999' } }),
  useThemedStyles: () => ({})
}))

type PreviewProps = Parameters<typeof MobileFileMarkdownPreview>[0]

async function renderPreview(props: PreviewProps): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(MobileFileMarkdownPreview, props))
  })
  if (!renderer) {
    throw new Error('MobileFileMarkdownPreview did not render')
  }
  return renderer
}

async function updatePreview(renderer: ReactTestRenderer, props: PreviewProps): Promise<void> {
  await act(async () => {
    renderer.update(createElement(MobileFileMarkdownPreview, props))
  })
}

function modeToggle(renderer: ReactTestRenderer, label: string) {
  const toggle = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === label)
  if (!toggle) {
    throw new Error(`Missing ${label} toggle`)
  }
  return toggle
}

async function selectMode(renderer: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => {
    modeToggle(renderer, label).props.onPress()
  })
}

function isSelected(renderer: ReactTestRenderer, label: string): boolean {
  return modeToggle(renderer, label).props.accessibilityState.selected === true
}

describe('MobileFileMarkdownPreview', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    renderer?.unmount()
    renderer = null
    vi.restoreAllMocks()
  })

  it('resets the selected mode for a new file or line target without remounting the preview', async () => {
    const baseProps: PreviewProps = {
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: false,
      byteLength: 7
    }
    renderer = await renderPreview(baseProps)

    expect(isSelected(renderer, 'View rendered Markdown preview')).toBe(true)
    await selectMode(renderer, 'View Markdown source')
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)

    // Content updates alone preserve the user's explicitly selected mode.
    await updatePreview(renderer, { ...baseProps, content: '# First updated' })
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)

    await updatePreview(renderer, { ...baseProps, relativePath: 'notes/second.md' })
    expect(isSelected(renderer, 'View rendered Markdown preview')).toBe(true)

    await updatePreview(renderer, { ...baseProps, relativePath: 'notes/second.md', initialLine: 8 })
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)
  })

  // Why: the session file tab draws source as numbered, virtualized lines — one
  // <Text> for the whole file froze the UI on a 4000-line file (2026-09-13). The
  // toggle must show that view, not a second one of the preview's own.
  it("shows the caller's own source view when it brought one", async () => {
    renderer = await renderPreview({
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: false,
      byteLength: 7,
      renderSource: () => createElement('CallerSourceView')
    })

    await selectMode(renderer, 'View Markdown source')
    const rendered = JSON.stringify(renderer.toJSON())
    expect(rendered).toContain('CallerSourceView')
    expect(rendered).not.toContain('MobileFilePreviewSourceText')
  })

  // Why: with no source view of its own, the shared preview text still has to
  // appear — the file screen has no numbered view to lend.
  it('falls back to the shared source text when the caller brought none', async () => {
    renderer = await renderPreview({
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: false,
      byteLength: 7
    })

    await selectMode(renderer, 'View Markdown source')
    expect(JSON.stringify(renderer.toJSON())).toContain('MobileFilePreviewSourceText')
  })

  // Why: a document view hides where the text stops, so a host-truncated file
  // has to say so above the rendering.
  it('says the document is cut off when the host truncated the file', async () => {
    renderer = await renderPreview({
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: true,
      byteLength: 400_000
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('MobileFilePreviewTruncatedNote')
  })
})
