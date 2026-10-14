// The file header of the Changes review shows the file's "+N -M", summed over its hunks, once
// the diff is drawn and whole. A diff the mobile cap cut, or one still loading, has no true count
// and draws none: a number from the rows on screen would be a guess.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { buildMobileDiffLines } from '../session/mobile-diff-lines'
import { buildMobileDiffHunks } from '../session/mobile-diff-hunks'
import type { ReviewDiffState } from '../session/mobile-diff-review-screen-model'
import type { MobileDiffReviewQueueItem } from '../session/mobile-diff-review-queue'
import { MobileDiffReviewFileSummary } from './MobileDiffReviewFileSummary'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp' }))

const ITEM = {
  key: 'a.ts',
  filePath: 'src/a.ts',
  status: 'modified',
  scope: 'unstaged',
  isReviewed: false,
  changedSinceReview: false,
  noteCount: 0,
  staleNoteCount: 0
} as unknown as MobileDiffReviewQueueItem

function ready(original: string, modified: string, truncated = false): ReviewDiffState {
  const built = buildMobileDiffLines(original, modified)
  return {
    kind: 'ready',
    itemKey: 'a.ts',
    lines: built.lines.map((line) => ({ ...line, segments: [], highlighted: false })),
    hunks: buildMobileDiffHunks(built.lines),
    truncated
  }
}

describe('the review file header\'s change count', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(diffState: ReviewDiffState) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileDiffReviewFileSummary
            currentIndex={0}
            diffState={diffState}
            fileNotes={[]}
            filteredCount={1}
            item={ITEM}
            staleCommentIds={new Set()}
            onEditNote={() => undefined}
            onJumpHunk={() => undefined}
          />
        </ThemeProvider>
      )
    })
  }

  const shown = () =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => [node.props.children].flat().join(''))

  it('sums the added and removed lines over every hunk', () => {
    // Two hunks: line 2 replaced (1 added, 1 removed), line 9 gone (0 added, 1 removed).
    render(ready('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n', '1\nTWO\n3\n4\n5\n6\n7\n8\n10\n'))
    expect(shown()).toContain('+1')
    expect(shown()).toContain(' -2')
  })

  it('draws no count while the diff loads', () => {
    render({ kind: 'loading', itemKey: 'a.ts' })
    expect(shown().filter((text) => /^[+ ]*[+-]\d+$/.test(text))).toEqual([])
  })

  it('draws no count for a diff the cap cut, since the rows on screen are not all of it', () => {
    render(ready('a\n', 'b\n', true))
    expect(shown().filter((text) => /^[+ ]*[+-]\d+$/.test(text))).toEqual([])
  })

  it('draws no count for a diff with no changed line', () => {
    render(ready('same\n', 'same\n'))
    expect(shown().filter((text) => /^[+ ]*[+-]\d+$/.test(text))).toEqual([])
  })
})
