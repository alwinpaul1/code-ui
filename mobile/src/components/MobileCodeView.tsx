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
  codeViewListLayout,
  codeViewMetrics,
  defaultCodeViewWrap
} from './mobile-code-view-layout'
import { makeCodeViewStyles } from './mobile-code-view-styles'
import { MobileCodeViewLine, type MobileCodeLineInteraction } from './MobileCodeViewLine'
import { useCodeDocumentHighlight } from './use-code-document-highlight'
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
  copyLabel = 'Copy file'
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
  /** That button's label: "Copy loaded text" for a cut preview. */
  copyLabel?: string
}) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const metrics = useMemo(
    () =>
      codeViewMetrics({
        lineCount: document.lines.length,
        maxColumns: document.maxColumns,
        fontScale: fontScale ?? 1
      }),
    [document, fontScale]
  )
  const styles = useMemo(() => makeCodeViewStyles(theme, metrics), [theme, metrics])
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
  const requestedIndex =
    wrapChoice?.doc === document
      ? wrapChoice.topLine
      : initialLine !== undefined && !document.reformatted
        ? initialLine - 1
        : undefined
  const startIndex =
    requestedIndex === undefined ? undefined : Math.min(Math.max(requestedIndex, 0), lastIndex)
  const { chunks, segmentsFor, requestLines } = useCodeDocumentHighlight(document, startIndex ?? 0)
  const listRef = useRef<FlatList<string>>(null)
  const topLineRef = useRef(startIndex ?? 0)
  const clip = !wrap && document.maxColumns > CODE_VIEW_MAX_NO_WRAP_COLUMNS
  const guideSpacing = document.indentStep * metrics.cellWidth

  // FlatList refuses a new viewability callback after mount; this one reads
  // the latest request function through a ref.
  const requestRef = useRef(requestLines)
  requestRef.current = requestLines
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const indices = viewableItems.flatMap((item) => (item.index == null ? [] : [item.index]))
    if (indices.length > 0) {
      topLineRef.current = Math.min(...indices)
      requestRef.current(topLineRef.current, Math.max(...indices))
    }
  }).current

  // Wrapped rows have no fixed height, so the list cannot open at a line; it
  // scrolls there once mounted. Unwrapped, `initialScrollIndex` does it.
  useEffect(() => {
    if (wrap && startIndex !== undefined && startIndex > 0) {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false })
    }
  }, [wrap, startIndex])
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

  const renderItem: ListRenderItem<string> = useCallback(
    ({ index }) => {
      const segments = segmentsFor(index)
      return (
        <MobileCodeViewLine
          number={index + 1}
          segments={clip ? clipSegmentsToColumns(segments, CODE_VIEW_MAX_NO_WRAP_COLUMNS) : segments}
          guides={document.guides[index] ?? 0}
          guideSpacing={guideSpacing}
          gutterDigits={metrics.gutterDigits}
          styles={styles}
          palette={theme.syntax}
          rowStyle={layout.rowStyle}
          numberOfLines={layout.numberOfLines}
          {...lineProps?.(index + 1)}
        />
      )
    },
    [clip, document, guideSpacing, layout, lineProps, metrics, segmentsFor, styles, theme.syntax]
  )
  const listExtraData = useMemo(() => ({ chunks, extraData }), [chunks, extraData])

  const list = (
    <FlatList
      ref={listRef}
      data={document.lines}
      style={[styles.list, layout.listStyle]}
      contentContainerStyle={styles.listContent}
      accessibilityLabel={accessibilityLabel}
      keyExtractor={(_line, index) => String(index)}
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
              style={styles.toolButton}
              onPress={() => fileCopy.copy(copyText)}
              accessibilityRole="button"
              accessibilityLabel={copyLabel}
              hitSlop={8}
            >
              {fileCopy.copied ? (
                <Check size={16} color={theme.colors.accent} strokeWidth={2.2} />
              ) : (
                <Copy size={16} color={theme.colors.textSecondary} strokeWidth={2.2} />
              )}
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
