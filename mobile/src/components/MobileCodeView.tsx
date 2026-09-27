import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type ViewToken
} from 'react-native'
import { Check, Copy, WrapText } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { clipSegmentsToColumns } from './mobile-code-indent'
import type { MobileCodeDocument } from './mobile-code-document'
import {
  CODE_VIEW_MAX_NO_WRAP_COLUMNS,
  codeViewFoldHitSlop,
  codeViewListLayout,
  codeViewMetrics,
  defaultCodeViewWrap
} from './mobile-code-view-layout'
import { makeCodeViewStyles } from './mobile-code-view-styles'
import { MobileCodeViewLine, type MobileCodeLineInteraction } from './MobileCodeViewLine'
import { listIndexOfLine } from './mobile-code-folding'
import { useCodeDocumentHighlight } from './use-code-document-highlight'
import { useCodeFolding, type CodeFolding } from './use-code-folding'
import { copyFailedNotice, useCopyToClipboard } from './use-copy-to-clipboard'

export type { MobileCodeLineInteraction } from './MobileCodeViewLine'

const VIEWABILITY = { itemVisiblePercentThreshold: 1 }

/**
 * A code file as the desktop's editor shows it (reported 2026-09-26): the
 * code face, line numbers, indent guides, Dark+ or Light+ colours from the
 * theme, and no wrapping — the file scrolls sideways as a whole, so every
 * line keeps its indentation. Rows are windowed and coloured a chunk at a
 * time, so a long file stays smooth and coloured. Wrapping is a toggle.
 */
export function MobileCodeView({
  document,
  accessibilityLabel,
  initialLine,
  notice,
  lineProps,
  extraData,
  copyText,
  copyLoadedOnly = false,
  folding: givenFolding
}: {
  document: MobileCodeDocument
  accessibilityLabel: string
  /** 1-based line to open at. Ignored on a pretty-printed file, whose line
   *  numbers are not the file's. */
  initialLine?: number
  /** A line of context above the code (truncation, reformatting). */
  notice?: string | null
  /** Per-line touch wiring (the file reader's line selection). */
  lineProps?: (lineNumber: number) => MobileCodeLineInteraction
  /** Anything else the rows read, so they redraw when it changes. */
  extraData?: unknown
  /** The text the toolbar's Copy button puts on the clipboard: the file as
   *  written. No button without it, or when it is empty. */
  copyText?: string
  /** The host sent only part of the file: the button copies what arrived,
   *  and says so in words ("Copy loaded text"), not only to TalkBack. */
  copyLoadedOnly?: boolean
  /** The document's folds, when the caller reads them too (a line selection
   *  over a fold takes in its hidden lines); the view keeps its own if not. */
  folding?: CodeFolding
}) {
  const theme = useTheme()
  const useGiven = givenFolding?.document === document
  const ownFolding = useCodeFolding(document, !useGiven)
  const folding = useGiven ? givenFolding : ownFolding
  const { visible } = folding
  const { fontScale } = useWindowDimensions()
  const metrics = useMemo(
    () =>
      codeViewMetrics({
        lineCount: document.lines.length,
        maxColumns: document.maxColumns,
        fontScale: fontScale ?? 1,
        foldable: document.folds.length > 0
      }),
    [document, fontScale]
  )
  const styles = useMemo(() => makeCodeViewStyles(theme, metrics), [theme, metrics])
  const foldHitSlop = useMemo(() => codeViewFoldHitSlop(metrics), [metrics])
  const [wrapChoice, setWrapChoice] = useState<{
    doc: MobileCodeDocument
    wrap: boolean
    topLine: number
  } | null>(null)
  const wrap = wrapChoice?.doc === document ? wrapChoice.wrap : defaultCodeViewWrap(document)
  const layout = useMemo(() => codeViewListLayout(wrap, metrics), [wrap, metrics])
  const lastIndex = document.lines.length - 1
  // Flipping wrap moves the list in or out of the sideways scroller, which
  // mounts it afresh; the line the reader was on comes along (`topLine`).
  // Lines are the file's (0-based); rows are the list's, which skip folded
  // lines, so a line is found on its row, or on the header folding it away.
  const requestedLine =
    wrapChoice?.doc === document
      ? wrapChoice.topLine
      : initialLine !== undefined && !document.reformatted
        ? initialLine - 1
        : undefined
  const startLine =
    requestedLine === undefined ? undefined : Math.min(Math.max(requestedLine, 0), lastIndex)
  const startIndex = startLine === undefined ? undefined : listIndexOfLine(visible, startLine)
  const { chunks, segmentsFor, requestLines } = useCodeDocumentHighlight(document, startLine ?? 0)
  const listRef = useRef<FlatList<number>>(null)
  const topLineRef = useRef(startLine ?? 0)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const clip = !wrap && document.maxColumns > CODE_VIEW_MAX_NO_WRAP_COLUMNS
  const guideSpacing = document.indentStep * metrics.cellWidth

  // FlatList refuses a new viewability callback after mount; this one reads
  // the latest request function through a ref.
  const requestRef = useRef(requestLines)
  requestRef.current = requestLines
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const rows = viewableItems.flatMap((item) => (item.index == null ? [] : [item.index])).sort((a, b) => a - b)
    const lines = rows.flatMap((row) => {
      const line = visibleRef.current[row]
      return line === undefined ? [] : [line]
    })
    if (lines.length === 0) {
      return
    }
    topLineRef.current = lines[0]!
    // Colour each run of lines on screen, not the folded lines between two
    // runs: a fold can hide thousands of lines, chunks of them.
    let runStart = lines[0]!
    for (let at = 1; at <= lines.length; at += 1) {
      const line = lines[at]
      const previous = lines[at - 1]!
      // A folded header's next row is the line after its block.
      if (line !== previous + 1) {
        requestRef.current(runStart, previous)
        if (line !== undefined) {
          runStart = line
        }
      }
    }
  }).current

  // Wrapped rows have no fixed height, so the list cannot open at a line; it
  // scrolls there once mounted. Unwrapped, `initialScrollIndex` does it. The
  // scroll is keyed on the file line and the document, not on its row: a
  // fold above the line moves its row, and keyed on the row the list jumped
  // after every fold (review, 2026-09-27).
  useEffect(() => {
    if (!wrap || startLine === undefined) {
      return
    }
    const index = listIndexOfLine(visibleRef.current, startLine)
    if (index > 0) {
      listRef.current?.scrollToIndex({ index, animated: false })
    }
  }, [document, wrap, startLine])
  const retried = useRef(false)
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // Not measured yet: jump by the average row, then try once more.
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
      if (!retried.current) {
        retried.current = true
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false }), 60)
      }
    },
    []
  )

  const renderItem: ListRenderItem<number> = useCallback(
    ({ index }) => {
      const line = visible[index]
      if (line === undefined) {
        return null
      }
      const segments = segmentsFor(line)
      const region = folding.regionAt(line)
      const folded = region !== undefined && folding.isFolded(line)
      return (
        <MobileCodeViewLine
          number={line + 1}
          segments={clip ? clipSegmentsToColumns(segments, CODE_VIEW_MAX_NO_WRAP_COLUMNS) : segments}
          guides={document.guides[line] ?? 0}
          guideSpacing={guideSpacing}
          gutterDigits={metrics.gutterDigits}
          styles={styles}
          palette={theme.syntax}
          rowStyle={layout.rowStyle}
          numberOfLines={layout.numberOfLines}
          foldColumn={metrics.foldWidth > 0}
          foldHitSlop={foldHitSlop}
          fold={
            region
              ? {
                  folded,
                  label: `${folded ? 'Unfold' : 'Fold'} lines ${region.start + 1}–${region.end + 1}`,
                  onToggle: () => folding.toggle(line)
                }
              : undefined
          }
          {...lineProps?.(line + 1)}
        />
      )
    },
    [clip, document, folding, foldHitSlop, guideSpacing, layout, lineProps, metrics, segmentsFor, styles, theme.syntax, visible]
  )
  const listExtraData = useMemo(() => ({ chunks, extraData }), [chunks, extraData])

  const list = (
    <FlatList
      ref={listRef}
      data={visible}
      style={[styles.list, layout.listStyle]}
      contentContainerStyle={styles.listContent}
      accessibilityLabel={accessibilityLabel}
      keyExtractor={(line) => String(line)}
      renderItem={renderItem}
      extraData={listExtraData}
      getItemLayout={layout.getItemLayout}
      initialScrollIndex={wrap ? undefined : startIndex}
      onScrollToIndexFailed={onScrollToIndexFailed}
      initialNumToRender={48}
      maxToRenderPerBatch={48}
      windowSize={9}
      removeClippedSubviews
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY}
    />
  )
  const fileCopy = useCopyToClipboard()
  const shownNotice = fileCopy.error ? copyFailedNotice(fileCopy.error) : notice
  const toggleWrap = () => {
    retried.current = false
    setWrapChoice({ doc: document, wrap: !wrap, topLine: topLineRef.current })
  }
  return (
    <View style={styles.root}>
      {shownNotice ? <Text style={styles.notice}>{shownNotice}</Text> : null}
      <View style={styles.area}>
        {layout.horizontal ? (
          <ScrollView
            horizontal
            style={styles.sideways}
            contentContainerStyle={styles.sidewaysContent}
            showsHorizontalScrollIndicator
            bounces={false}
          >
            {list}
          </ScrollView>
        ) : (
          list
        )}
        {/* After the code in the tree, so it paints over it without a z-index. */}
        <View style={styles.toolbar}>
          {copyText ? (
            // The whole file, as the Claude app's code blocks copy theirs; a
            // block of lines is copied from the long-press bar (2026-09-26:
            // one Text per row ended the OS selection at the row's end).
            <Pressable
              style={copyLoadedOnly ? [styles.toolButton, styles.toolButtonWide] : styles.toolButton}
              onPress={() => fileCopy.copy(copyText)}
              accessibilityRole="button"
              accessibilityLabel={copyLoadedOnly ? 'Copy loaded text' : 'Copy file'}
              hitSlop={8}
            >
              {fileCopy.copied ? (
                <Check size={16} color={theme.colors.accent} strokeWidth={2.2} />
              ) : (
                <Copy size={16} color={theme.colors.textSecondary} strokeWidth={2.2} />
              )}
              {copyLoadedOnly ? <Text style={styles.toolLabel}>Copy loaded text</Text> : null}
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.toolButton, wrap && styles.toolButtonOn]}
            onPress={toggleWrap}
            accessibilityRole="button"
            accessibilityLabel="Wrap lines"
            accessibilityState={{ selected: wrap }}
            hitSlop={8}
          >
            <WrapText size={16} color={wrap ? theme.colors.accent : theme.colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}
