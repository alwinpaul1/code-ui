import { createMarkdownInlineMatcher, type MarkdownInlineMatch } from './markdown-inline-matcher'
import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { computeTableColumnWidths, tableColumnCount } from './mobile-markdown-table-layout'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_LIST_INDENT,
  useMarkdownStyles,
  type MarkdownStyles
} from './mobile-markdown-styles'
import {
  detectFilePathSegments,
  isFilePathCodeSpan,
  normalizeFilePath
} from './markdown-file-path-detection'
import { routeMarkdownHref } from './markdown-href-routing'
import {
  isIntrawordUnderscoreToken,
  trimAutolinkTrailingPunctuation
} from './markdown-inline-token-rules'
import { parseMobileMarkdown, type MobileMarkdownListItem } from './mobile-markdown-parser'
import { useChatTextSelectable } from './chat-text-selectable-context'
import { splitInlineCodeChips } from './mobile-markdown-code-chip-split'
import { renderMarkdownCodeBlock } from './MobileMarkdownCodeBlock'
import { markdownChipScale, markdownProseScale } from './mobile-markdown-prose-scale'

/** Every inline span is a rounded, bordered View chip, as in the Claude app.
 *  Only a span with a newline in it stays a nested Text. */
export function isInlineCodeChip(code: string): boolean {
  return code.length > 0 && !code.includes('\n')
}

type Props = {
  content?: string
  fallback?: string
  /** Multiplier for prose font size (paragraphs, lists, quotes). Defaults to 1;
   *  the chat view passes a pinch-zoom factor. */
  textScale?: number
  /** When provided, detected file paths and file-target hrefs render as tappable
   *  and invoke this with the path text (worktree-relative or absolute, with an
   *  optional :line(:col) suffix). Omitted on screens with no file viewer, where
   *  paths render as plain text (no behavior change). */
  onOpenFile?: (pathText: string) => void
}

const MAX_TABLE_ROWS = 40
const MAX_TABLE_COLUMNS = 8
/** Bullet per nesting level, so a sub-item reads as one even where the indent
 *  alone is too narrow to see at ~40 columns. Deeper levels reuse the last. */
const LIST_BULLETS = ['•', '◦', '▪']

// Web/mail hrefs open the system handler; file-target hrefs (file: URIs and
// scheme-less paths — the entire desktop file-link contract) go to onOpenFile.
function openMarkdownHref(href: string, onOpenFile?: (pathText: string) => void): void {
  const route = routeMarkdownHref(href)
  if (route.kind === 'web') {
    void Linking.openURL(route.url).catch(() => {})
    return
  }
  if (route.kind === 'file' && onOpenFile) {
    onOpenFile(route.pathText)
  }
}

function headingScale(styles: MarkdownStyles, level: number): MarkdownStyles[keyof MarkdownStyles] | null {
  if (level <= 1) {
    return styles.headingLevel1
  }
  if (level === 2) {
    return styles.headingLevel2
  }
  if (level === 3) {
    return styles.headingLevel3
  }
  return null
}

/** `3.` for an ordered item that starts at 3, the level's bullet otherwise, and
 *  a box for a task item whichever list it sits in. */
function listMarker(item: MobileMarkdownListItem): string {
  // The rest of an item that a fence interrupted keeps the indent and takes no
  // marker; a second bullet would read as a second item.
  if (item.continuation) {
    return ''
  }
  if (item.checked != null) {
    return item.checked ? '☑' : '☐'
  }
  if (item.ordered) {
    return `${item.number ?? 1}.`
  }
  return LIST_BULLETS[Math.min(item.depth, LIST_BULLETS.length - 1)]!
}

// Render a plain (non-token) text run, splitting out tappable file paths when
// onOpenFile is provided. Without it, paths stay plain text.
function renderTextRun(
  styles: MarkdownStyles,
  text: string,
  keyPrefix: string,
  onOpenFile?: (pathText: string) => void
): ReactNode {
  if (!onOpenFile) {
    return text
  }
  const segments = detectFilePathSegments(text)
  if (segments.length === 1 && segments[0]!.type === 'text') {
    return text
  }
  return segments.map((segment, segmentIndex) => {
    if (segment.type === 'file') {
      return (
        <Text
          key={`${keyPrefix}:${segmentIndex}`}
          style={styles.link}
          onPress={() => onOpenFile(segment.path)}
        >
          {segment.value}
        </Text>
      )
    }
    return <Fragment key={`${keyPrefix}:${segmentIndex}`}>{segment.value}</Fragment>
  })
}

function renderInline(
  styles: MarkdownStyles,
  text: string,
  onOpenFile?: (pathText: string) => void,
  /** Pill sizes at the reader's zoom; null when they have not zoomed. */
  chipScale?: ReturnType<typeof markdownChipScale>
): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = createMarkdownInlineMatcher(
    text,
    /(`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/g,
    true
  )
  let pendingStart = 0
  let match: MarkdownInlineMatch | null

  while ((match = pattern.exec())) {
    const token = match[0]
    // Intraword `_` runs (snake_case, dunder tails) are literal text per
    // CommonMark; leaving them unflushed keeps surrounding file paths whole
    // for detection in the eventual text run.
    if (token.startsWith('_') && isIntrawordUnderscoreToken(text, match.index, token)) {
      // Resume after the opener so real tokens inside the rejected span are still scanned.
      pattern.lastIndex = match.index + 1
      continue
    }
    if (match.index > pendingStart) {
      parts.push(
        renderTextRun(styles, text.slice(pendingStart, match.index), `t${pendingStart}`, onOpenFile)
      )
    }
    pendingStart = pattern.lastIndex
    const key = `${match.index}:${token}`
    const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (image) {
      parts.push(
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(image[2]!, onOpenFile)}>
          {image[1] || 'image'}
        </Text>
      )
    } else if (link) {
      parts.push(
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(link[2]!, onOpenFile)}>
          {link[1]}
        </Text>
      )
    } else if (/^https?:\/\//i.test(token)) {
      const { url, trailing } = trimAutolinkTrailingPunctuation(token)
      parts.push(
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(url, onOpenFile)}>
          {url}
        </Text>
      )
      if (trailing) {
        parts.push(<Fragment key={`${key}p`}>{trailing}</Fragment>)
      }
    } else if (token.startsWith('`')) {
      const code = token.slice(1, -1)
      const openFile =
        onOpenFile && isFilePathCodeSpan(code)
          ? () => onOpenFile(normalizeFilePath(code.trim()))
          : undefined
      if (isInlineCodeChip(code)) {
        // A real inline View: the only way Android rounds and borders a chip.
        // It cannot break across lines, so a long span is several pills that
        // wrap. Its text is outside a press-and-hold selection of the prose;
        // the message copy button still carries it.
        splitInlineCodeChips(code).forEach((piece, pieceIndex) => {
          parts.push(
            <View
              key={`${key}c${pieceIndex}`}
              // A plain object when the reader has not zoomed: an array per
              // chip costs an allocation on every render of every message, and
              // it hides `borderRadius` from anything reading the style.
              style={
                chipScale
                  ? [
                      styles.inlineCodeChip,
                      {
                        paddingVertical: chipScale.paddingVertical,
                        borderRadius: chipScale.borderRadius
                      }
                    ]
                  : styles.inlineCodeChip
              }
            >
              <Text
                style={[
                  styles.inlineCodeChipText,
                  chipScale
                    ? { fontSize: chipScale.fontSize, lineHeight: chipScale.lineHeight }
                    : null,
                  openFile ? styles.inlineCodeLink : null
                ]}
                onPress={openFile}
              >
                {piece}
              </Text>
            </View>
          )
        })
      } else {
        parts.push(
          <Text
            key={key}
            style={[styles.inlineCode, openFile ? styles.inlineCodeLink : null]}
            onPress={openFile}
          >
            {code}
          </Text>
        )
      }
    } else if (token.startsWith('~~')) {
      parts.push(
        <Text key={key} style={styles.strike}>
          {renderInline(styles, token.slice(2, -2), onOpenFile, chipScale)}
        </Text>
      )
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(
        <Text key={key} style={styles.bold}>
          {renderInline(styles, token.slice(2, -2), onOpenFile, chipScale)}
        </Text>
      )
    } else {
      parts.push(
        <Text key={key} style={styles.italic}>
          {renderInline(styles, token.slice(1, -1), onOpenFile, chipScale)}
        </Text>
      )
    }
  }

  if (pendingStart < text.length) {
    parts.push(renderTextRun(styles, text.slice(pendingStart), `t${pendingStart}`, onOpenFile))
  }
  return parts
}

function MobileMarkdownInner({ content, fallback = '', textScale = 1, onOpenFile }: Props) {
  const selectable = useChatTextSelectable()
  const styles = useMarkdownStyles()
  const text = content?.trim() ?? ''
  const previewText = useMemo(() => normalizeMobileMarkdownPreviewHtml(text), [text])
  const blocks = useMemo(() => parseMobileMarkdown(previewText), [previewText])
  // Prose and pill sizes move together; see mobile-markdown-prose-scale.ts for
  // why the line height is not simply `(size + 8) * scale`.
  const scaled = (size: number) => markdownProseScale(size, textScale)
  const proseScale = scaled(MARKDOWN_BASE_SIZE)
  const chipScale = markdownChipScale(textScale)
  if (!text) {
    return fallback ? <Text style={styles.paragraph}>{fallback}</Text> : null
  }
  const mermaidSourceOccurrences = new Map<string, number>()

  // Why one Text per run: Android confines a selection to a single Text node,
  // so a reader could select one paragraph but never the next (2026-09-12,
  // screenshot). Consecutive paragraphs and headings become one selectable
  // Text, headings as nested styled spans and a blank line between blocks;
  // quotes, lists, fences, tables and images still start a new run.
  type Block = (typeof blocks)[number]
  type ProseBlock = Extract<Block, { type: 'paragraph' | 'heading' }>
  type Run = { start: number; blocks: Block[]; prose: ProseBlock[] | null }
  const runs: Run[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    const last = runs.at(-1)
    if (block.type === 'paragraph' || block.type === 'heading') {
      if (last?.prose && last.start + last.blocks.length === index) {
        last.blocks.push(block)
        last.prose.push(block)
      } else {
        runs.push({ start: index, blocks: [block], prose: [block] })
      }
    } else {
      runs.push({ start: index, blocks: [block], prose: null })
    }
  }

  return (
    <View style={styles.root}>
      {runs.map((run) => {
        const index = run.start
        const block = run.blocks[0]!
        if (run.prose) {
          return (
            <Text key={index} selectable={selectable} style={[styles.paragraph, proseScale]}>
              {run.prose.map((member, memberIndex) => (
                <Fragment key={memberIndex}>
                  {memberIndex > 0 ? '\n\n' : null}
                  {member.type === 'heading' ? (
                    <Text style={[styles.heading, headingScale(styles, member.level)]}>
                      {renderInline(styles, member.text, onOpenFile, chipScale)}
                    </Text>
                  ) : (
                    // One inline pass over the WHOLE paragraph. Matching line by
                    // line left `**bold` on one source line and `text**` on the
                    // next as literal asterisks on the phone (reported from the
                    // device); the parser has already reflowed soft wraps, so
                    // any newline left here is a deliberate hard break.
                    renderInline(styles, member.text, onOpenFile, chipScale)
                  )}
                </Fragment>
              ))}
            </Text>
          )
        }
        if (block.type === 'quote') {
          return (
            <View key={index} style={styles.quote}>
              <Text selectable={selectable} style={[styles.quoteText, proseScale]}>
                {renderInline(styles, block.text, onOpenFile, chipScale)}
              </Text>
            </View>
          )
        }
        if (block.type === 'code') {
          return renderMarkdownCodeBlock({
            block,
            index,
            styles,
            selectable,
            mermaidSourceOccurrences
          })
        }
        if (block.type === 'image') {
          return (
            <Pressable
              key={index}
              style={styles.imageFrame}
              onPress={() => openMarkdownHref(block.url, onOpenFile)}
            >
              <Text style={styles.link}>{block.alt || 'Open image'}</Text>
              <Text style={styles.imageCaption} numberOfLines={1}>
                {block.url}
              </Text>
            </Pressable>
          )
        }
        if (block.type === 'table') {
          const totalColumns = tableColumnCount(block.headers, block.rows)
          const columnCount = Math.min(totalColumns, MAX_TABLE_COLUMNS)
          const visibleRows = block.rows.slice(0, MAX_TABLE_ROWS)
          const hiddenRows = Math.max(0, block.rows.length - visibleRows.length)
          const hiddenColumns = Math.max(0, totalColumns - columnCount)
          // One width per column, shared by the header and every row; see
          // mobile-markdown-table-layout.ts for why rows must not size themselves.
          const columnWidths = computeTableColumnWidths({
            headers: block.headers,
            rows: visibleRows,
            columnCount,
            fontSize: (MARKDOWN_BASE_SIZE - 2) * textScale,
            horizontalPadding: styles.tableCell.paddingHorizontal
          })
          const columns = Array.from({ length: columnCount }, (_, cellIndex) => cellIndex)
          return (
            // A table that runs past the screen needs the same telling.
            <ScrollView key={index} horizontal showsHorizontalScrollIndicator persistentScrollbar>
              <View style={styles.table}>
                <View style={styles.tableRow}>
                  {columns.map((cellIndex) => (
                    <Text
                      key={cellIndex}
                      selectable={selectable}
                      style={[styles.tableCell, styles.tableHeader, { width: columnWidths[cellIndex] }]}
                    >
                      {renderInline(styles, block.headers[cellIndex] ?? '', onOpenFile, chipScale)}
                    </Text>
                  ))}
                </View>
                {visibleRows.map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.tableRow}>
                    {columns.map((cellIndex) => (
                      <Text
                        key={cellIndex}
                        selectable={selectable}
                        style={[styles.tableCell, { width: columnWidths[cellIndex] }]}
                      >
                        {renderInline(styles, row[cellIndex] ?? '', onOpenFile, chipScale)}
                      </Text>
                    ))}
                  </View>
                ))}
                {hiddenRows > 0 || hiddenColumns > 0 ? (
                  <Text style={styles.tableTruncated}>
                    {hiddenRows > 0 ? `${hiddenRows} more rows` : ''}
                    {hiddenRows > 0 && hiddenColumns > 0 ? ' · ' : ''}
                    {hiddenColumns > 0 ? `${hiddenColumns} more columns` : ''}
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          )
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View
                  key={itemIndex}
                  style={[
                    styles.listItem,
                    item.depth > 0 ? { marginLeft: item.depth * MARKDOWN_LIST_INDENT } : null
                  ]}
                >
                  <Text style={[styles.listMarker, proseScale]}>{listMarker(item)}</Text>
                  <Text selectable={selectable} style={[styles.listText, proseScale]}>
                    {renderInline(styles, item.text, onOpenFile, chipScale)}
                  </Text>
                </View>
              ))}
            </View>
          )
        }
        if (block.type === 'rule') {
          return <View key={index} style={styles.rule} />
        }
        return null
      })}
    </View>
  )
}

export const MobileMarkdown = memo(MobileMarkdownInner)
