import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

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
vi.mock('../components/MobileRichMarkdownEditor', () => ({
  MobileRichMarkdownEditor: 'MobileRichMarkdownEditor'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('lucide-react-native', () => ({ Eye: 'Eye', Pencil: 'Pencil', RefreshCw: 'RefreshCw' }))

import { MarkdownReader } from './MobileSessionMarkdownReader'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { MarkdownDocState } from './mobile-session-route-types'

const READY: MarkdownDocState = {
  status: 'ready',
  localContent: '# Title',
  editable: true,
  isDirty: false,
  saving: false,
  stale: false
} as MarkdownDocState
const LOADING = { status: 'loading' } as MarkdownDocState
const FAILED = { status: 'error', message: 'Could not read the file' } as MarkdownDocState

function render(doc: MarkdownDocState, preference: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: preference },
        createElement(MarkdownReader, {
          documentId: 'd1',
          doc,
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

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign(
    {},
    ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean)
  )
}

function outermostView(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAllByType('View' as never)[0]!
}

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

// The file tab's frame is on the static dark palette, and the reader drew its
// loading and error states straight onto it: in light mode a document opened
// as a dark screen with a grey spinner, then a light page. The reader now
// paints its own surface from the live theme, and what it draws on that
// surface follows the theme too (0.6.6 audit; same shape as the onboarding
// title that measured 1.07:1 on the light background).
describe('the .md tab’s reader, in light and in dark', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`paints its loading state on the ${scheme} page, with a spinner the page can show`, () => {
      const renderer = render(LOADING, scheme)
      expect(flatten(outermostView(renderer).props.style).backgroundColor).toBe(colors.bg)
      const spinner = renderer.root.findByType('ActivityIndicator' as never)
      expect(spinner.props.color).toBe(colors.textSecondary)
      act(() => renderer.unmount())
    })

    it(`paints its error state on the ${scheme} page, in the ${scheme} danger tone`, () => {
      const renderer = render(FAILED, scheme)
      expect(flatten(outermostView(renderer).props.style).backgroundColor).toBe(colors.bg)
      const message = renderer.root
        .findAllByType('Text' as never)
        .find((node) => node.props.children === 'Could not read the file')!
      expect(flatten(message.props.style).color).toBe(colors.danger)
      act(() => renderer.unmount())
    })

    it(`paints the ${scheme} page behind the toggle bar and the preview`, () => {
      const renderer = render(READY, scheme)
      expect(flatten(outermostView(renderer).props.style).backgroundColor).toBe(colors.bg)
      act(() => renderer.unmount())
    })
  }
})
