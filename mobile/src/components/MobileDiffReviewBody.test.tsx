// The body of the Changes review screen: its states and its hunks, in both themes.
//
// The states follow the Claude app's diff (`yc20.c` in com.anthropic.claude 1.261009.20): a
// spinner and "Loading changes…", "No changes yet", "Unable to load changes" with the reason under
// it. The hunks follow `jye.c` and `jlc.e`: three lines beside each change, a fold row between
// them reading "+N lines", and a tap that opens it.

import { createElement, forwardRef, useImperativeHandle, type ReactElement, type Ref } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { buildMobileDiffLines, type MobileDiffLine } from '../session/mobile-diff-lines'
import { buildMobileDiffHunks } from '../session/mobile-diff-hunks'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'
import type { ReviewDiffState, ReviewScreenState } from '../session/mobile-diff-review-screen-model'

const scrollToIndex = vi.fn()
const scrollToOffset = vi.fn()

vi.mock('react-native', () => {
  const FlatList = forwardRef(function FlatList(
    {
      data,
      renderItem,
      ListFooterComponent
    }: {
      data: unknown[]
      renderItem: (info: { item: unknown; index: number }) => ReactElement
      ListFooterComponent?: ReactElement | null
    },
    ref: Ref<unknown>
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex, scrollToOffset }))
    return createElement(
      'FlatList',
      null,
      data.map((item, index) => createElement('Item', { key: index }, renderItem({ item, index }))),
      ListFooterComponent
    )
  })
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList,
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({
  Pencil: 'Pencil',
  Trash2: 'Trash2',
  RefreshCw: 'RefreshCw',
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  UnfoldVertical: 'UnfoldVertical'
}))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))
vi.mock('./MobileSyntaxSegments', () => ({ MobileSyntaxSegments: () => null }))

const { MobileDiffReviewBody } = await import('./MobileDiffReviewBody')

type BodyProps = Parameters<typeof MobileDiffReviewBody>[0]

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

// 100 lines with line 51 changed.
function middleChange() {
  const original = numbered(100)
  const modified = [...original]
  modified[50] = 'CHANGED'
  return buildMobileDiffLines(`${original.join('\n')}\n`, `${modified.join('\n')}\n`)
}

function readyDiff(built: { lines: MobileDiffLine[]; truncated?: boolean }): ReviewDiffState {
  return {
    kind: 'ready',
    itemKey: 'a.ts',
    lines: plain(built.lines),
    hunks: buildMobileDiffHunks(built.lines),
    truncated: built.truncated ?? false
  }
}

const READY_SCREEN = { kind: 'ready' } as unknown as ReviewScreenState

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('the body of the review screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    scrollToIndex.mockClear()
    scrollToOffset.mockClear()
  })

  function render(scheme: 'light' | 'dark', overrides: Partial<BodyProps> = {}) {
    const props: BodyProps = {
      activeHunkIndex: null,
      commentsByLine: new Map(),
      currentItem: null,
      diffState: readyDiff(middleChange()),
      emptyReason: 'no-changes',
      filteredCount: 1,
      listRef: { current: null },
      screenState: READY_SCREEN,
      staleCommentIds: new Set<string>(),
      onAddNote: () => undefined,
      onEditNote: () => undefined,
      onDeleteNote: () => undefined,
      onRetry: undefined,
      ...overrides
    }
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewBody {...props} />
        </ThemeProvider>
      )
    })
    return props
  }

  function text(label: string) {
    return renderer!.root
      .findAllByType('Text' as never)
      .find((node) => [node.props.children].flat().join('') === label)
  }

  describe('states', () => {
    it.each([
      ['light', lightColors],
      ['dark', darkColors]
    ] as const)('says "Loading changes…" under a spinner while the review loads (%s)', (scheme, colors) => {
      render(scheme, { screenState: { kind: 'loading' } })
      expect(renderer!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(1)
      const label = text('Loading changes…')
      expect(label).toBeDefined()
      expect(flatStyle(label!.props.style)).toMatchObject({
        color: colors.composerIcon,
        fontSize: 15,
        textAlign: 'center'
      })
    })

    it('says "Loading changes…" while one file\'s diff loads', () => {
      render('light', { diffState: { kind: 'loading', itemKey: 'a.ts' } })
      expect(text('Loading changes…')).toBeDefined()
    })

    it.each([
      ['light', lightColors],
      ['dark', darkColors]
    ] as const)('says "No changes yet" and what to expect when nothing has changed (%s)', (scheme, colors) => {
      render(scheme, { filteredCount: 0, emptyReason: 'no-changes' })
      const title = text('No changes yet')
      expect(title).toBeDefined()
      expect(flatStyle(title!.props.style)).toMatchObject({ color: colors.text, fontSize: 17 })
      const description = text('Changes will appear here after Claude makes edits.')
      expect(flatStyle(description!.props.style)).toMatchObject({
        color: colors.composerIcon,
        fontSize: 15,
        textAlign: 'center'
      })
    })

    it('says the filter is what hides the files when it is', () => {
      render('light', { filteredCount: 0, emptyReason: 'filtered' })
      expect(text('No reviewable changes')).toBeDefined()
      expect(text('Try a different review filter.')).toBeDefined()
    })

    it('says "Unable to load changes" with the reason, and offers a retry', () => {
      const onRetry = vi.fn()
      render('dark', { screenState: { kind: 'error', message: 'Waiting for desktop...' }, onRetry })
      expect(text('Unable to load changes')).toBeDefined()
      expect(text('Waiting for desktop...')).toBeDefined()
      const retry = renderer!.root.findByProps({ accessibilityLabel: 'Retry loading review' })
      act(() => retry.props.onPress())
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('falls back to the app\'s own sentence when a failed diff came with no reason', () => {
      render('light', { diffState: { kind: 'error', itemKey: 'a.ts', message: '' } })
      expect(text('Unable to load changes')).toBeDefined()
      expect(text('Something went wrong. Please try again.')).toBeDefined()
    })

    it.each([
      [{ kind: 'binary', itemKey: 'a.png' }, 'Binary diff', 'This file cannot be rendered as text on mobile.'],
      [
        { kind: 'too-large', itemKey: 'a.ts' },
        'Diff too large',
        'This diff is too large for the mobile preview.'
      ],
      [
        { kind: 'deleted', itemKey: 'a.ts' },
        'Deleted file',
        'This file was deleted. Add a file note or mark it reviewed.'
      ],
      [{ kind: 'idle' }, 'Diff unavailable', 'Select a file to review.']
    ] as const)('names a %j diff in sentence case', (diffState, title, description) => {
      render('light', { diffState: diffState as ReviewDiffState })
      expect(text(title)).toBeDefined()
      expect(text(description)).toBeDefined()
    })

    // Review of 302aa95f8: an empty new file or a mode-only change is a queued file, not a repo
    // with nothing changed, so "No changes yet ... after Claude makes edits" misdescribed it.
    it('says a file with no lines has none to compare, not that nothing has changed', () => {
      render('light', { diffState: readyDiff({ lines: [] }) })
      expect(text('No line changes')).toBeDefined()
      expect(text('This file has no lines to compare.')).toBeDefined()
      expect(text('No changes yet')).toBeUndefined()
    })
  })

  describe('hunks', () => {
    it('draws three lines beside the change and folds the rest, with "+N lines"', () => {
      render('light')
      // 50 unchanged above line 51: 47 folded, 3 kept; 49 below: 3 kept, 46 folded.
      expect(text('+47 lines')).toBeDefined()
      expect(text('+46 lines')).toBeDefined()
      expect(text('48')).toBeDefined()
      expect(text('49')).toBeDefined()
      expect(text('50')).toBeDefined()
      expect(text('+51')).toBeDefined()
      expect(text('47')).toBeUndefined()
      expect(text('55')).toBeUndefined()
    })

    it('opens the top fold three lines at a time from the change', () => {
      render('light')
      const top = renderer!.root.findByProps({ accessibilityLabel: 'Expand down, +47 lines' })
      act(() => top.props.onPress())
      expect(text('+44 lines')).toBeDefined()
      expect(text('45')).toBeDefined()
      expect(text('47')).toBeDefined()
      expect(text('44')).toBeUndefined()
    })

    it('opens the bottom fold three lines at a time from the change', () => {
      render('dark')
      const bottom = renderer!.root.findByProps({ accessibilityLabel: 'Expand up, +46 lines' })
      act(() => bottom.props.onPress())
      expect(text('+43 lines')).toBeDefined()
      expect(text('55')).toBeDefined()
      expect(text('57')).toBeDefined()
      expect(text('58')).toBeUndefined()
    })

    it('keeps what was opened across a redraw of the same rows', () => {
      const props = render('light')
      act(() =>
        renderer!.root.findByProps({ accessibilityLabel: 'Expand down, +47 lines' }).props.onPress()
      )
      expect(text('45')).toBeDefined()
      act(() =>
        renderer!.update(
          <ThemeProvider initialPreference="light">
            <MobileDiffReviewBody {...props} activeHunkIndex={0} />
          </ThemeProvider>
        )
      )
      expect(text('45')).toBeDefined()
      expect(text('+44 lines')).toBeDefined()
    })

    // Review of 302aa95f8: a comment save rebuilds the queue, the diff loads again, and the new
    // array holds the same rows. The reader's open folds shut under them.
    it('keeps what was opened when the same diff is loaded again as a new array', () => {
      const props = render('light')
      act(() =>
        renderer!.root.findByProps({ accessibilityLabel: 'Expand down, +47 lines' }).props.onPress()
      )
      expect(text('45')).toBeDefined()
      act(() =>
        renderer!.update(
          <ThemeProvider initialPreference="light">
            <MobileDiffReviewBody {...props} diffState={readyDiff(middleChange())} />
          </ThemeProvider>
        )
      )
      expect(text('45')).toBeDefined()
      expect(text('+44 lines')).toBeDefined()
    })

    it('closes what was opened when the rows that load are different ones', () => {
      const props = render('light')
      act(() =>
        renderer!.root.findByProps({ accessibilityLabel: 'Expand down, +47 lines' }).props.onPress()
      )
      expect(text('45')).toBeDefined()
      // The file was edited and loaded again: the same key, other rows.
      const original = numbered(100)
      const modified = [...original]
      modified[50] = 'CHANGED'
      modified[10] = 'ALSO CHANGED'
      act(() =>
        renderer!.update(
          <ThemeProvider initialPreference="light">
            <MobileDiffReviewBody
              {...props}
              diffState={readyDiff(
                buildMobileDiffLines(`${original.join('\n')}\n`, `${modified.join('\n')}\n`)
              )}
            />
          </ThemeProvider>
        )
      )
      expect(text('45')).toBeUndefined()
    })

    it('draws a one-line diff as that line alone, with no fold', () => {
      render('light', { diffState: readyDiff(buildMobileDiffLines('', 'only\n')) })
      expect(text('+1')).toBeDefined()
      expect(renderer!.root.findAllByProps({ accessibilityHint: undefined, accessibilityRole: 'button' }).filter((n) => String(n.props.accessibilityLabel).startsWith('Expand'))).toHaveLength(0)
    })

    it('sends a hunk jump to the row that now draws the change', () => {
      const props = render('light')
      const diff = props.diffState as Extract<ReviewDiffState, { kind: 'ready' }>
      const target = diff.hunks[0]!
      act(() => {
        props.listRef.current!.scrollToIndex({ index: target.startIndex, animated: true, viewPosition: 0.16 })
      })
      // Raw row 50 is the 5th row drawn (gap, 3 lines, then the change at display index 4).
      expect(scrollToIndex).toHaveBeenCalledWith({ index: 4, animated: true, viewPosition: 0.16 })
    })

    it('hands a delete to the caller with the comment it was asked on', () => {
      const comment: DiffComment = {
        id: 'c1',
        worktreeId: 'w',
        filePath: 'a.ts',
        lineNumber: 51,
        body: 'No',
        createdAt: 1,
        side: 'modified'
      }
      const onDeleteNote = vi.fn()
      render('light', { commentsByLine: new Map([[51, [comment]]]), onDeleteNote })
      const del = renderer!.root.findByProps({ accessibilityLabel: 'Delete comment' })
      act(() => del.props.onPress())
      expect(onDeleteNote).toHaveBeenCalledWith(comment)
    })

    it('keeps a commented unchanged line on screen, however far it is from a change', () => {
      const comment: DiffComment = {
        id: 'c1',
        worktreeId: 'w',
        filePath: 'a.ts',
        lineNumber: 10,
        body: 'Look at this',
        createdAt: 1,
        side: 'modified'
      }
      render('light', { commentsByLine: new Map([[10, [comment]]]) })
      expect(text('10')).toBeDefined()
      expect(text('Look at this')).toBeDefined()
    })
  })
})
