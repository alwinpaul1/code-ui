import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
// Why: lucide's entry pulls React Native internals the host-tag mock above removed.
vi.mock('lucide-react-native', () => ({ Code: 'Code', Pencil: 'Pencil' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileFilePreviewSourceText', () => ({
  MobileFilePreviewSourceText: 'MobileFilePreviewSourceText',
  MobileFilePreviewTruncatedNote: 'MobileFilePreviewTruncatedNote'
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileFileMarkdownPreview } from './MobileFileMarkdownPreview'

function renderInScheme(scheme: 'light' | 'dark'): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: scheme },
        createElement(MobileFileMarkdownPreview, {
          relativePath: 'CLAUDE.md',
          content: '# Rules',
          truncated: false,
          byteLength: 7
        })
      )
    )
  })
  if (!renderer) {
    throw new Error('MobileFileMarkdownPreview did not render')
  }
  return renderer
}

function backgroundsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll(() => true)
    .flatMap((node) => {
      const style: unknown = node.props?.style
      const entries = Array.isArray(style) ? style : [style]
      return entries.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return []
        }
        const background = (entry as { backgroundColor?: unknown }).backgroundColor
        return typeof background === 'string' ? [background] : []
      })
    })
}

function iconColorsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.type === 'Code' || node.type === 'Pencil')
    .map((node) => String(node.props.color))
}

describe('the markdown file preview in both themes', () => {
  // Why: the rendered document below the toolbar already follows the appearance
  // setting (MobileMarkdown is themed), so a toolbar pinned to one palette puts
  // dark chrome over a light page for anyone on Light.
  it('paints its toolbar from the live theme, not one fixed palette', () => {
    const light = backgroundsOf(renderInScheme('light'))
    const dark = backgroundsOf(renderInScheme('dark'))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).not.toEqual(light)
  })

  it('colours the source and preview icons from the live theme too', () => {
    const light = iconColorsOf(renderInScheme('light'))
    const dark = iconColorsOf(renderInScheme('dark'))
    expect(light).toHaveLength(2)
    expect(dark).not.toEqual(light)
  })
})
