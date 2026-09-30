import { useMemo, useState } from 'react'
import { computeTableColumnWidths, tableColumnCount } from '../mobile-markdown-table-layout'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { openExternalLink } from '../../platform/external-link'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../../theme/theme-context'
import type { Theme } from '../../theme/theme-context'
import type { ThemeColors } from '../../theme/tokens'
import { MermaidDiagram } from './MermaidDiagram'
import { isAllowedMarkdownLinkUrl } from './markdown-link-scheme'
import { listMarker } from '../mobile-markdown-list-marker'
import {
  parseInline,
  parseMarkdownBlocks,
  type CellAlign,
  type InlineToken,
  type MarkdownBlock
} from './markdown-blocks'

type Props = {
  content: string
  // PR body uses a slightly larger base than inline comment cards (mirrors desktop).
  variant?: 'document' | 'comment'
}

type Styles = ReturnType<typeof commentMarkdownStyles>

/** One level of list nesting, as the chat steps one in (LIST_INDENT_TEXT in
 *  MobileMarkdown.tsx, four spaces, about 16 px). Past MAX_LIST_INDENT_LEVELS
 *  the items stop stepping in, so a deep one keeps room for its words in a
 *  comment card; its bullet still says how deep it is. */
const LIST_INDENT = spacing.lg
const MAX_LIST_INDENT_LEVELS = 6

// Themed, dependency-free markdown for PR bodies + comments — the RN analogue of
// the desktop CommentMarkdown. The previous third-party renderer hung the JS thread
// on mount; this renders a small block model and falls back to plain text on any
// parse error, so it can never crash the comment list.
export function CommentMarkdown({ content, variant = 'comment' }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(commentMarkdownStyles)
  const base = variant === 'document' ? typography.bodySize : 13
  const blocks = useMemo<MarkdownBlock[] | null>(() => {
    try {
      return parseMarkdownBlocks(content)
    } catch {
      return null
    }
  }, [content])

  if (!blocks) {
    return (
      <Text style={[styles.paragraph, { fontSize: base, lineHeight: base + 7 }]}>{content}</Text>
    )
  }

  return (
    <View>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} base={base} styles={styles} colors={colors} />
      ))}
    </View>
  )
}

function DetailsBlock({
  summary,
  body,
  base,
  styles,
  colors
}: {
  summary: string
  body: MarkdownBlock[]
  base: number
  styles: Styles
  colors: ThemeColors
}) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={styles.details}>
      <Pressable
        style={styles.detailsSummary}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
      >
        <Chevron size={14} color={colors.textSecondary} strokeWidth={2.2} />
        <Text style={[styles.detailsSummaryText, { fontSize: base }]}>{summary}</Text>
      </Pressable>
      {open ? (
        <View style={styles.detailsBody}>
          {body.map((b, i) => (
            <BlockView key={i} block={b} base={base} styles={styles} colors={colors} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function BlockView({
  block,
  base,
  styles,
  colors
}: {
  block: MarkdownBlock
  base: number
  styles: Styles
  colors: ThemeColors
}) {
  switch (block.kind) {
    case 'details':
      return (
        <DetailsBlock summary={block.summary} body={block.body} base={base} styles={styles} colors={colors} />
      )
    case 'heading':
      return (
        <Text style={[styles.heading, { fontSize: base + Math.max(0, 4 - block.level) }]}>
          <Inline text={block.text} base={base} styles={styles} />
        </Text>
      )
    case 'code':
      // Mermaid fences render as diagrams (WebView), not as raw code.
      if (block.lang === 'mermaid') {
        return <MermaidDiagram source={block.text} base={base} />
      }
      return (
        <View style={styles.codeBlock}>
          <Text style={[styles.codeText, { fontSize: base - 1 }]}>{block.text}</Text>
        </View>
      )
    case 'table':
      return <TableBlock block={block} base={base} styles={styles} />
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={[styles.paragraph, { fontSize: base, lineHeight: base + 7 }]}>
            <Inline text={block.text} base={base} styles={styles} />
          </Text>
        </View>
      )
    case 'hr':
      return <View style={styles.hr} />
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => {
            // A flat list carries no shapes: every item at the margin, numbered from `start`.
            const shape = block.shapes?.[i] ?? { depth: 0, ordered: block.ordered, number: (block.start ?? 1) + i }
            const indent = Math.min(shape.depth, MAX_LIST_INDENT_LEVELS) * LIST_INDENT
            const box = shape.checked === undefined ? null : { checked: shape.checked }
            return (
              <View
                key={i}
                testID="comment-list-item"
                style={indent > 0 ? [styles.listItem, { marginLeft: indent }] : styles.listItem}
              >
                <Text
                  style={[styles.bullet, { fontSize: base }]}
                  accessibilityRole={box ? 'checkbox' : undefined}
                  accessibilityState={box ?? undefined}
                >
                  {listMarker({ text: item, ...shape })}
                </Text>
                <Text
                  style={[
                    styles.paragraph,
                    styles.listItemText,
                    { fontSize: base, lineHeight: base + 7 }
                  ]}
                >
                  <Inline text={item} base={base} styles={styles} />
                </Text>
              </View>
            )
          })}
        </View>
      )
    case 'paragraph':
      return (
        <Text style={[styles.paragraph, { fontSize: base, lineHeight: base + 7 }]}>
          <Inline text={block.text} base={base} styles={styles} />
        </Text>
      )
  }
}

function openMarkdownLink(url: string): void {
  if (!isAllowedMarkdownLinkUrl(url)) {
    return
  }
  openExternalLink(url)
}

function alignToFlex(align: CellAlign | undefined): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'center') {
    return 'center'
  }
  if (align === 'right') {
    return 'flex-end'
  }
  return 'flex-start'
}

// GFM table rendered with Views. A horizontal ScrollView keeps wide tables from
// breaking the sidebar layout; fixed-width columns give cells room to sit side by side.
function TableBlock({
  block,
  base,
  styles
}: {
  block: Extract<MarkdownBlock, { kind: 'table' }>
  base: number
  styles: Styles
}) {
  const columnCount = tableColumnCount(block.headers, block.rows)
  const columns = Array.from({ length: columnCount }, (_, c) => c)
  // One width per column shared by every row; a cell that sizes itself makes
  // the grid stagger row by row (same defect as the chat table, 2026-09-09).
  const columnWidths = computeTableColumnWidths({
    headers: block.headers,
    rows: block.rows,
    columnCount,
    fontSize: base - 1,
    horizontalPadding: 8
  })
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}
      contentContainerStyle={styles.table}
    >
      <View>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          {columns.map((c) => (
            <View
              key={c}
              style={[styles.tableCell, { width: columnWidths[c], alignItems: alignToFlex(block.align[c]) }]}
            >
              <Text style={[styles.tableHeaderText, { fontSize: base - 1 }]}>
                <Inline text={block.headers[c] ?? ''} base={base} styles={styles} />
              </Text>
            </View>
          ))}
        </View>
        {block.rows.map((row, r) => (
          <View key={r} style={styles.tableRow}>
            {columns.map((c) => (
              <View
                key={c}
                style={[styles.tableCell, { width: columnWidths[c], alignItems: alignToFlex(block.align[c]) }]}
              >
                <Text style={[styles.tableCellText, { fontSize: base - 1 }]}>
                  <Inline text={row[c] ?? ''} base={base} styles={styles} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function Inline({ text, base, styles }: { text: string; base: number; styles: Styles }) {
  const tokens = useMemo<InlineToken[]>(() => {
    try {
      return parseInline(text)
    } catch {
      return [{ kind: 'text', text }]
    }
  }, [text])
  return (
    <>
      {tokens.map((token, i) => {
        // Emphasis draws its inside through Inline again, as the chat does:
        // `***x***` is bold around `*x*`, and a code span or link inside a
        // bold is still one. The depth is bounded: a bold closes at the first
        // run of its own two marks, so it cannot hold a bold of its own kind,
        // and an italic's inside holds no mark of its own character.
        if (token.kind === 'bold') {
          return (
            <Text key={i} style={styles.bold}>
              <Inline text={token.text} base={base} styles={styles} />
            </Text>
          )
        }
        if (token.kind === 'italic') {
          return (
            <Text key={i} style={styles.italic}>
              <Inline text={token.text} base={base} styles={styles} />
            </Text>
          )
        }
        if (token.kind === 'code') {
          return (
            <Text key={i} style={[styles.codeInline, { fontSize: base - 1 }]}>
              {token.text}
            </Text>
          )
        }
        if (token.kind === 'link') {
          // The label draws through Inline too, so [`<T>`](url) reads as a
          // code chip inside the link rather than its backticks. A label ends
          // at its first ']', so it cannot hold a link of its own.
          return (
            <Text key={i} style={styles.link} onPress={() => openMarkdownLink(token.url)}>
              <Inline text={token.text} base={base} styles={styles} />
            </Text>
          )
        }
        return <Text key={i}>{token.text}</Text>
      })}
    </>
  )
}

function commentMarkdownStyles({ colors }: Theme) {
  return StyleSheet.create({
    paragraph: { color: colors.text, marginBottom: spacing.sm },
    heading: { color: colors.text, fontWeight: '700', marginBottom: spacing.xs },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    link: { color: colors.text, textDecorationLine: 'underline' },
    codeInline: {
      color: colors.text,
      fontFamily: typography.monoFamily,
      backgroundColor: colors.bgRaised
    },
    codeBlock: {
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.row,
      padding: spacing.sm,
      marginBottom: spacing.sm
    },
    codeText: { color: colors.text, fontFamily: typography.monoFamily },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      backgroundColor: colors.bgRaised,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      marginBottom: spacing.sm
    },
    hr: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
    list: { marginBottom: spacing.sm },
    listItem: { flexDirection: 'row', gap: spacing.xs },
    listItemText: { flex: 1, marginBottom: 2 },
    bullet: { color: colors.textSecondary },
    details: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.row,
      marginBottom: spacing.sm,
      overflow: 'hidden'
    },
    detailsSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: colors.bgRaised
    },
    detailsSummaryText: { color: colors.text, fontWeight: '600', flexShrink: 1 },
    detailsBody: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
    tableScroll: { marginBottom: spacing.sm },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.row,
      overflow: 'hidden'
    },
    tableRow: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    tableHeaderRow: { borderTopWidth: 0, backgroundColor: colors.bgRaised },
    tableCell: {
      // width is set per column by TableBlock (shared across rows)
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border
    },
    tableHeaderText: { color: colors.text, fontWeight: '700' },
    tableCellText: { color: colors.text }
  })
}
