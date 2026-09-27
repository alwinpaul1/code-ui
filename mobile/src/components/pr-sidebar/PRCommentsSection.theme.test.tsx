// The PR sidebar's Comments section in both themes: the Description/Comments
// cards, their section header dividers, and the "No description" / "No comments"
// placeholders all came from the static dark-only `mobile-theme` palette before
// the theme-sweep pass, so a light-mode session still saw dark cards here.
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubWorkItemDetails } from '../../../../src/shared/github/work-item-types'
import { darkColors, lightColors } from '../../theme/tokens'
import { ThemeProvider } from '../../theme/theme-context'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
// Not reached by the "no comments" render path under test (the card list is
// empty and the composer is gated off with no `actions`), but statically
// imported by PRCommentsSection.tsx.
vi.mock('./CommentMarkdown', () => ({ CommentMarkdown: 'CommentMarkdown' }))
vi.mock('./PRCommentCard', () => ({ PRCommentCard: 'PRCommentCard' }))
vi.mock('./PRCommentComposer', () => ({ PRCommentComposer: 'PRCommentComposer' }))

const { PRCommentsSection } = await import('./PRCommentsSection')

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

function textWithChildren(renderer: ReactTestRenderer, text: string) {
  return renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.props.children === text)
}

const DETAILS: GitHubWorkItemDetails = {
  item: {
    id: 'pr:99',
    type: 'pr',
    number: 99,
    title: 'A pull request',
    state: 'open',
    url: '',
    labels: [],
    updatedAt: '',
    author: null
  },
  body: '',
  comments: []
}

describe('the PR sidebar comments section, empty state', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the section cards and placeholder text from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <PRCommentsSection details={DETAILS} prState="open" />
        </ThemeProvider>
      )
    })

    // Both section cards (Description + Comments) share the flat bgPanel band.
    const sections = renderer!.root
      .findAllByType('View' as never)
      .filter((node) => styleOf(node).backgroundColor === palette.bgPanel)
    expect(sections.length).toBe(2)

    const noDescription = textWithChildren(renderer!, 'No description provided.')
    expect(noDescription).toBeDefined()
    expect(styleOf(noDescription!).color).toBe(palette.textSecondary)

    const noComments = textWithChildren(renderer!, 'No comments yet.')
    expect(noComments).toBeDefined()
    expect(styleOf(noComments!).color).toBe(palette.textSecondary)
  })
})
