// The rows a long diff folds into, and the footer of a cut one, as the diff review and the
// branch-diff drawer draw them, in both themes.
//
// A folded run ("2,896 unchanged lines") and the cut row are not lines of the file: they are drawn
// as their own muted band, with no line number and nothing to tap, so no review note can land on
// them. The footer of a cut diff says what it left out instead of only that it cut something.

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

const { MobileDiffReviewLine } = await import('./MobileDiffReviewLine')
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

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line-${index + 1}`)
}

// 3,000 lines with line 2,900 changed: folds, fits, no cut.
function foldedDiff() {
  const original = numbered(3_000)
  const modified = [...original]
  modified[2_899] = 'CHANGED'
  return buildMobileDiffLines(`${original.join('\n')}\n`, `${modified.join('\n')}\n`)
}

// 3,000 lines rewritten whole: cut at the cap.
function cutDiff() {
  const original = numbered(3_000)
  const modified = original.map((line) => `new-${line}`)
  return buildMobileDiffLines(`${original.join('\n')}\n`, `${modified.join('\n')}\n`)
}

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('folded and cut rows of a long diff', () => {
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

  function textNode(text: string) {
    return renderer!.root
      .findAllByType('Text' as never)
      .find((node) => [node.props.children].flat().join('') === text)
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'draws a folded run in review as a muted band nobody can note on (%s)',
    (scheme, palette) => {
      const folded = plain(foldedDiff().lines)[0]!
      render(
        createElement(MobileDiffReviewLine, {
          line: folded,
          comments: [],
          staleCommentIds: new Set<string>(),
          active: false,
          onAddNote: () => undefined,
          onEditNote: () => undefined
        }),
        scheme
      )

      const text = textNode('2,896 unchanged lines')
      expect(text).toBeDefined()
      expect(flatStyle(text!.props.style).color).toBe(palette.textMuted)
      expect(
        flatStyle(renderer!.root.findAllByType('View' as never)[0]!.props.style).backgroundColor
      ).toBe(palette.bgSunken)
      expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    }
  )

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('says what a cut review diff left out, under it (%s)', (scheme, palette) => {
    const diff = cutDiff()
    render(
      createElement(MobileDiffReviewBody, {
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
      }),
      scheme
    )

    const footer = textNode(
      'Diff truncated for mobile preview: 500 deleted and 3,000 added lines not shown.'
    )
    expect(footer).toBeDefined()
    expect(flatStyle(footer!.props.style).color).toBe(palette.textMuted)
    const cutRow = textNode('... 500 deleted and 3,000 added lines not shown on mobile ...')
    expect(flatStyle(cutRow!.props.style).color).toBe(palette.textMuted)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'draws folded rows and the cut footer in the branch-diff drawer (%s)',
    (scheme, palette) => {
      const folded = foldedDiff()
      render(
        createElement(MobileBranchDiffPreviewDrawer, {
          branchDiffPreview: {
            kind: 'ready',
            entry: { path: 'a.ts', status: 'modified' } as never,
            summary: { baseRef: 'main' } as never,
            lines: plain(folded.lines),
            truncated: folded.truncated
          },
          onClose: () => undefined
        }),
        scheme
      )

      const band = textNode('97 unchanged lines')
      expect(flatStyle(band!.props.style).color).toBe(palette.textMuted)
      // Only the file's own lines carry a number; a folded row has none to show.
      expect(textNode('2900')).toBeDefined()

      const cut = cutDiff()
      render(
        createElement(MobileBranchDiffPreviewDrawer, {
          branchDiffPreview: {
            kind: 'ready',
            entry: { path: 'a.ts', status: 'modified' } as never,
            summary: { baseRef: 'main' } as never,
            lines: plain(cut.lines),
            truncated: cut.truncated
          },
          onClose: () => undefined
        }),
        scheme
      )
      expect(
        textNode('Diff truncated for mobile preview: 500 deleted and 3,000 added lines not shown.')
      ).toBeDefined()
    }
  )
})
