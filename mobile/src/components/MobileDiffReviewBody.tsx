import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'
import type { RefObject } from 'react'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import {
  buildMobileDiffDisplayRows,
  expandMobileDiffGap,
  mobileDiffGapAction,
  NO_MOBILE_DIFF_EXPANSION,
  type MobileDiffDisplayRow,
  type MobileDiffExpandDirection,
  type MobileDiffExpansion
} from '../source-control/mobile-diff-expand'
import { mobileDiffGutterWidth } from '../source-control/mobile-diff-claude-palette'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { MobileDiffGapRow } from './MobileDiffGapRow'
import { MobileDiffReviewLine } from './MobileDiffReviewLine'
import { describeMobileDiffTruncation } from '../session/mobile-diff-notes'
import type {
  ReviewDiffLine,
  ReviewDiffState,
  ReviewScreenState
} from '../session/mobile-diff-review-screen-model'
import type { MobileDiffReviewQueueItem } from '../session/mobile-diff-review-queue'
import { mobileDiffReviewStyles } from './mobile-diff-review-screen-styles'

type Props = {
  activeHunkIndex: number | null
  commentsByLine: ReadonlyMap<number, DiffComment[]>
  currentItem: MobileDiffReviewQueueItem | null
  diffState: ReviewDiffState
  filteredCount: number
  /** Why there is nothing to list: the repo has no changes, or the filter hides them. */
  emptyReason: 'no-changes' | 'filtered'
  listRef: RefObject<FlatList<ReviewDiffLine> | null>
  screenState: ReviewScreenState
  staleCommentIds: ReadonlySet<string>
  onAddNote: (lineNumber: number) => void
  onEditNote: (comment: DiffComment) => void
  onDeleteNote: (comment: DiffComment) => void
  onRetry: (() => void) | undefined
}

/** The Claude app's own sentence for a failure that came with no reason (`yc20.c`). */
const GENERIC_FAILURE = 'Something went wrong. Please try again.'

/**
 * The review's body. Its states are the Claude app's diff screen (`yc20.c` in com.anthropic.claude
 * 1.261009.20): "Loading changes…", "No changes yet", "Unable to load changes" and the reason. The
 * app has no wording for a binary, an oversized or a deleted file, so those keep Code UI's own, in
 * the same layout and in sentence case like the rest.
 */
export function MobileDiffReviewBody({
  activeHunkIndex,
  commentsByLine,
  currentItem,
  diffState,
  filteredCount,
  emptyReason,
  listRef,
  screenState,
  staleCommentIds,
  onAddNote,
  onEditNote,
  onDeleteNote,
  onRetry
}: Props) {
  if (screenState.kind === 'loading') {
    return <CenteredState text="Loading changes…" busy />
  }
  if (screenState.kind === 'error' || screenState.kind === 'unavailable') {
    return (
      <CenteredState
        title={screenState.kind === 'unavailable' ? 'Review unavailable' : 'Unable to load changes'}
        text={screenState.message || GENERIC_FAILURE}
        onRetry={onRetry}
      />
    )
  }
  if (filteredCount === 0) {
    return emptyReason === 'filtered' ? (
      <CenteredState title="No reviewable changes" text="Try a different review filter." />
    ) : (
      <NoChanges />
    )
  }
  if (diffState.kind === 'loading') {
    return <CenteredState text="Loading changes…" busy />
  }
  if (diffState.kind !== 'ready') {
    return <DiffUnavailableState diffState={diffState} onRetry={onRetry} />
  }
  if (diffState.lines.length === 0) {
    return <NoChanges />
  }
  return (
    <MobileDiffReviewHunks
      activeHunkIndex={activeHunkIndex}
      commentsByLine={commentsByLine}
      currentItem={currentItem}
      diffState={diffState}
      listRef={listRef}
      staleCommentIds={staleCommentIds}
      onAddNote={onAddNote}
      onEditNote={onEditNote}
      onDeleteNote={onDeleteNote}
    />
  )
}

/** An expansion, and the rows it was made on: it names raw rows, so it means nothing on any others. */
type OpenedFold = { lines: readonly ReviewDiffLine[]; expansion: MobileDiffExpansion }

function MobileDiffReviewHunks({
  activeHunkIndex,
  commentsByLine,
  currentItem,
  diffState,
  listRef,
  staleCommentIds,
  onAddNote,
  onEditNote,
  onDeleteNote
}: Omit<Props, 'filteredCount' | 'emptyReason' | 'screenState' | 'onRetry' | 'diffState'> & {
  diffState: Extract<ReviewDiffState, { kind: 'ready' }>
}) {
  const styles = useThemedStyles(mobileDiffReviewStyles)
  const innerRef = useRef<FlatList<MobileDiffDisplayRow<ReviewDiffLine>> | null>(null)
  const { lines, hunks } = diffState
  // What was opened belongs to the rows it was opened on: another file, or the same file loaded
  // again after a stage or an edit, starts folded again.
  const [opened, setOpened] = useState<OpenedFold>({
    lines,
    expansion: NO_MOBILE_DIFF_EXPANSION
  })
  const expansion = opened.lines === lines ? opened.expansion : NO_MOBILE_DIFF_EXPANSION

  const gutterWidth = useMemo(
    () =>
      mobileDiffGutterWidth(
        lines.reduce((max, line) => Math.max(max, line.newLineNumber ?? line.oldLineNumber ?? 0), 0)
      ),
    [lines]
  )
  // A line that carries a comment is drawn whatever its distance from a change.
  const pinned = useMemo(() => {
    const raw = new Set<number>()
    lines.forEach((line, index) => {
      if (
        line.kind !== 'delete' &&
        line.newLineNumber !== undefined &&
        (commentsByLine.get(line.newLineNumber)?.length ?? 0) > 0
      ) {
        raw.add(index)
      }
    })
    return raw
  }, [commentsByLine, lines])
  const { rows, displayIndexOfRaw } = useMemo(
    () => buildMobileDiffDisplayRows(lines, expansion, pinned),
    [expansion, lines, pinned]
  )

  // The controller scrolls to a hunk by the row's index in the file; the list draws folds, so
  // that index is not the list's. The controller keeps its ref and its call, and the ref it holds
  // answers in the list's own indexes.
  useImperativeHandle(
    listRef as unknown as RefObject<Pick<FlatList, 'scrollToIndex' | 'scrollToOffset'>>,
    () => ({
      scrollToIndex: (params) =>
        innerRef.current?.scrollToIndex({ ...params, index: displayIndexOfRaw(params.index) }),
      scrollToOffset: (params) => innerRef.current?.scrollToOffset(params)
    }),
    [displayIndexOfRaw]
  )

  const expand = useCallback(
    (gap: Parameters<typeof expandMobileDiffGap>[1], direction: MobileDiffExpandDirection) => {
      setOpened({ lines, expansion: expandMobileDiffGap(expansion, gap, direction) })
    },
    [expansion, lines]
  )

  const keyPrefix = currentItem?.key ?? 'diff'
  return (
    <FlatList
      ref={innerRef}
      data={rows}
      keyExtractor={(row) =>
        row.kind === 'gap' ? `${keyPrefix}:gap:${row.gap.start}` : `${keyPrefix}:${row.rawIndex}`
      }
      renderItem={({ item: row }) => {
        if (row.kind === 'gap') {
          return (
            <MobileDiffGapRow
              hiddenLines={row.gap.hiddenLines}
              action={mobileDiffGapAction(row.gap)}
              gutterWidth={gutterWidth}
              onExpand={(direction) => expand(row.gap, direction)}
            />
          )
        }
        const line = row.line
        const lineNumber = line.newLineNumber ?? -1
        const active =
          activeHunkIndex !== null &&
          row.rawIndex >= (hunks[activeHunkIndex]?.startIndex ?? -1) &&
          row.rawIndex <= (hunks[activeHunkIndex]?.endIndex ?? -1)
        return (
          <MobileDiffReviewLine
            line={line}
            comments={commentsByLine.get(lineNumber) ?? []}
            staleCommentIds={staleCommentIds}
            active={active}
            gutterWidth={gutterWidth}
            onAddNote={onAddNote}
            onEditNote={onEditNote}
            onDeleteNote={onDeleteNote}
          />
        )
      }}
      contentContainerStyle={styles.diffList}
      onScrollToIndexFailed={(info) => {
        innerRef.current?.scrollToOffset({
          offset: Math.max(0, info.averageItemLength * info.index),
          animated: true
        })
      }}
      ListFooterComponent={
        diffState.truncated ? (
          <Text style={styles.truncatedText}>{describeMobileDiffTruncation(lines)}</Text>
        ) : null
      }
    />
  )
}

function NoChanges() {
  return (
    <CenteredState
      title="No changes yet"
      text="Changes will appear here after Claude makes edits."
    />
  )
}

function DiffUnavailableState({
  diffState,
  onRetry
}: {
  diffState: ReviewDiffState
  onRetry: (() => void) | undefined
}) {
  const title =
    diffState.kind === 'binary'
      ? 'Binary diff'
      : diffState.kind === 'too-large'
        ? 'Diff too large'
        : diffState.kind === 'deleted'
          ? 'Deleted file'
          : diffState.kind === 'error'
            ? 'Unable to load changes'
            : 'Diff unavailable'
  const text =
    diffState.kind === 'binary'
      ? 'This file cannot be rendered as text on mobile.'
      : diffState.kind === 'too-large'
        ? 'This diff is too large for the mobile preview.'
        : diffState.kind === 'deleted'
          ? 'This file was deleted. Add a file note or mark it reviewed.'
          : diffState.kind === 'error'
            ? diffState.message || GENERIC_FAILURE
            : 'Select a file to review.'
  return <CenteredState title={title} text={text} onRetry={onRetry} />
}

function CenteredState({
  busy,
  title,
  text,
  onRetry
}: {
  busy?: boolean
  title?: string
  text: string
  onRetry?: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(mobileDiffReviewStyles)
  return (
    <View style={styles.state}>
      {busy ? <ActivityIndicator color={colors.composerIcon} /> : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={[styles.stateText, busy && styles.stateTextBusy]}>{text}</Text>
      {onRetry ? (
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading review"
        >
          <RefreshCw size={14} color={colors.text} strokeWidth={2.2} />
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
