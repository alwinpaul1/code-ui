// The final-newline and line-endings rows, as the diff review and the branch-diff drawer draw
// them, in both themes. A file whose only change is its final newline, or its line endings, used to
// open on a diff of nothing but context rows; these rows are how the preview now says what changed.

import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { buildMobileDiffLines, type MobileDiffLine } from '../session/mobile-diff-lines'
import { buildMobileDiffHunks } from '../session/mobile-diff-hunks'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: ({
    data,
    renderItem,
    ListFooterComponent
  }: {
    data: unknown[]
    renderItem: (info: { item: unknown; index: number }) => ReactElement
    ListFooterComponent?: ReactElement | null
  }) =>
    createElement(
      'FlatList',
      null,
      data.map((item, index) => renderItem({ item, index })),
      ListFooterComponent
    ),
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  MessageSquare: 'MessageSquare',
  RefreshCw: 'RefreshCw',
  X: 'X'
}))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))
vi.mock('./MobileSyntaxSegments', () => ({ MobileSyntaxSegments: () => null }))
vi.mock('./BottomDrawer', async () => {
  const { createElement: h } = await import('react')
  return {
    BottomDrawer: ({ children }: { children?: ReactNode }) => h('BottomDrawer', null, children)
  }
})

const { MobileDiffReviewBody } = await import('./MobileDiffReviewBody')
const { MobileBranchDiffPreviewDrawer } =
  await import('../source-control/MobileBranchDiffPreviewDrawer')

function plain(lines: MobileDiffLine[]): MobileHighlightedDiffLine<MobileDiffLine>[] {
  return lines.map((line) => ({
    ...line,
    segments: [{ text: line.text, kind: 'plain' }],
    highlighted: false
  }))
}

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('the final-newline and line-endings rows', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(element: ReactElement, scheme: 'light' | 'dark') {
    act(() => {
      renderer = create(createElement(ThemeProvider, { initialPreference: scheme }, element))
    })
  }

  function band(text: string) {
    const node = renderer!.root
      .findAllByType('Text' as never)
      .find((candidate) => candidate.props.children === text)
    return { text: node, row: node?.parent }
  }

  function review(original: string, modified: string) {
    const diff = buildMobileDiffLines(original, modified)
    return createElement(MobileDiffReviewBody, {
      activeHunkIndex: null,
      commentsByLine: new Map(),
      currentItem: null,
      diffState: {
        kind: 'ready',
        itemKey: 'a.ts',
        lines: plain(diff.lines),
        hunks: buildMobileDiffHunks(diff.lines),
        truncated: diff.truncated
      },
      filteredCount: 1,
      listRef: { current: null },
      screenState: { kind: 'ready' } as never,
      staleCommentIds: new Set<string>(),
      onAddNote: () => undefined,
      onEditNote: () => undefined,
      onRetry: undefined
    })
  }

  function drawer(original: string, modified: string) {
    const diff = buildMobileDiffLines(original, modified)
    return createElement(MobileBranchDiffPreviewDrawer, {
      branchDiffPreview: {
        kind: 'ready',
        entry: { path: 'a.ts', status: 'modified' } as never,
        summary: { baseRef: 'main' } as never,
        lines: plain(diff.lines),
        truncated: diff.truncated
      },
      onClose: () => undefined
    })
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'says only the line endings changed, in review and in the drawer (%s)',
    (scheme, palette) => {
      for (const element of [review('a\r\nb\r\n', 'a\nb\n'), drawer('a\r\nb\r\n', 'a\nb\n')]) {
        render(element, scheme)
        const notice = band('Only line endings changed (CRLF → LF)')
        expect(notice.text).toBeDefined()
        expect(flatStyle(notice.text!.props.style).color).toBe(palette.textMuted)
        expect(flatStyle(notice.row!.props.style).backgroundColor).toBe(palette.bgSunken)
      }
    }
  )

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'marks a missing final newline, in review and in the drawer (%s)',
    (scheme, palette) => {
      for (const element of [review('a\nb', 'a\nb\n'), drawer('a\nb', 'a\nb\n')]) {
        render(element, scheme)
        const note = band('\\ No newline at end of file')
        expect(note.text).toBeDefined()
        expect(flatStyle(note.text!.props.style).color).toBe(palette.textMuted)
        expect(flatStyle(note.row!.props.style).backgroundColor).toBe(palette.bgSunken)
      }
    }
  )
})
