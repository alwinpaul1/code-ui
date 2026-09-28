import {
  codeSpanContent,
  createMarkdownInlineMatcher,
  type MarkdownInlineMatch
} from './markdown-inline-matcher'
import { Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { computeTableColumnWidths, tableColumnCount } from './mobile-markdown-table-layout'
import { ScrollView, Text, View } from 'react-native'
import { openExternalLink } from '../platform/external-link'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import {
  MARKDOWN_BASE_SIZE,
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
import { MobileMarkdownImage } from './MobileMarkdownImage'
import { isRemoteImageUrl, type MarkdownImageResolver } from './markdown-image-source'
import { renderMarkdownCodeBlock } from './MobileMarkdownCodeBlock'
import { MobileMarkdownCodeChip } from './MobileMarkdownCodeChip'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import { MarkdownSelectionRoot } from './markdown-selection-copy'
import { markdownProseScale, markdownZoomedLine } from './mobile-markdown-prose-scale'
import { buildProseRuns } from './mobile-markdown-prose-runs'
import {
  markdownDocumentKey,
  useMarkdownCodePillRuns,
  type CodePillRun
} from './use-markdown-code-pill-runs'

/** Every inline span is a rounded, bordered View chip, as in the Claude app,
 *  one per line it crosses. Only a span with a newline in it stays a nested
 *  Text. */
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
  /** Reads an image named from the document (`![fig](fig/plot.svg)`) off the
   *  host, so it draws as the image. Without it, and for anything the host
   *  cannot give, an image stays the tappable link inside the prose run. */
  resolveImage?: MarkdownImageResolver
  /** The message this is, where a list recycles one cell for many: what
   *  code pills learnt about one message is not used for another, and is
   *  kept while the same one streams in (use-markdown-code-pill-runs.ts). */
  identity?: string
}

const MAX_TABLE_ROWS = 40
/** A `---` drawn as text so it can sit inside a selectable run. Copies as a
 *  divider, which is what the source line is. */
const RULE_TEXT = '─'.repeat(24)
const MAX_TABLE_COLUMNS = 8
/** Bullet per nesting level, so a sub-item reads as one even where the indent
 *  alone is too narrow to see at ~40 columns. Deeper levels reuse the last. */
const LIST_BULLETS = ['•', '◦', '▪']
/** One level of list nesting inside the prose run, as text: a span cannot
 *  carry a margin, so the indent is spaces. Four is about 16 px at the prose
 *  size. Narrow on purpose: at ~40 columns a desktop-sized indent leaves a
 *  third-level item too little room to read. */
const LIST_INDENT_TEXT = '    '

// Web/mail hrefs open the system handler; file-target hrefs (file: URIs and
// scheme-less paths — the entire desktop file-link contract) go to onOpenFile.
function openMarkdownHref(href: string, onOpenFile?: (pathText: string) => void): void {
  const route = routeMarkdownHref(href)
  if (route.kind === 'web') {
    // The seam, not react-native's `Linking`: this module is in the tasks page closure, and inside
    // the shell's WebView `openURL` resolves without opening anything.
    openExternalLink(route.url)
    return
  }
  if (route.kind === 'file' && onOpenFile) {
    onOpenFile(route.pathText)
  }
}

/** A heading's style over its level, with its size and line height at the
 *  reader's zoom. */
function headingStyle(styles: MarkdownStyles, level: number, textScale: number) {
  const scale =
    level <= 1 ? styles.headingLevel1 : level === 2 ? styles.headingLevel2 : level === 3 ? styles.headingLevel3 : null
  const line = { ...styles.heading, ...scale }
  return [styles.heading, scale, markdownZoomedLine(line.fontSize, line.lineHeight, textScale)]
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
          {...HOLD_DOES_NOT_OPEN}
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
  onOpenFile: ((pathText: string) => void) | undefined,
  /** How the Text this lands in cuts its code spans into pills, from its own
   *  measured lines (use-markdown-code-pill-runs.ts). */
  pills: CodePillRun
): ReactNode[] {
  const parts: ReactNode[] = []
  pills.noteSource(text)
  // Code spans are found by backtick run inside the matcher, not here.
  const pattern = createMarkdownInlineMatcher(
    text,
    /(~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/g,
    true,
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
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(image[2]!, onOpenFile)} {...HOLD_DOES_NOT_OPEN}>
          {image[1] || 'image'}
        </Text>
      )
    } else if (link) {
      parts.push(
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(link[2]!, onOpenFile)} {...HOLD_DOES_NOT_OPEN}>
          {link[1]}
        </Text>
      )
    } else if (/^https?:\/\//i.test(token)) {
      const { url, trailing } = trimAutolinkTrailingPunctuation(token)
      parts.push(
        <Text key={key} style={styles.link} onPress={() => openMarkdownHref(url, onOpenFile)} {...HOLD_DOES_NOT_OPEN}>
          {url}
        </Text>
      )
      if (trailing) {
        parts.push(<Fragment key={`${key}p`}>{trailing}</Fragment>)
      }
    } else if (token.startsWith('`')) {
      const code = codeSpanContent(token)
      const openFile =
        onOpenFile && isFilePathCodeSpan(code)
          ? () => onOpenFile(normalizeFilePath(code.trim()))
          : undefined
      if (isInlineCodeChip(code)) {
        // A pill of its own, selectable on its own; see MobileMarkdownCodeChip.
        const { pieces, version } = pills.cut(code, text.slice(pattern.lastIndex))
        pieces.forEach((piece, pieceIndex) => {
          parts.push(
            <MobileMarkdownCodeChip
              // The paragraph's length is in the key on purpose. Android
              // positions an inline View from the paragraph's layout and does
              // not move it when the paragraph re-wraps unless the View itself
              // changes — so a chip near a line break stayed where it had been
              // before the text ahead of it moved down a line, drawn across the
              // words now there (2026-09-18, "commits on `main`" with the pill
              // over "commits", on a message that re-wrapped as it streamed).
              // `match.index` alone only changes when text before the chip
              // grows; the length changes when text after it does too. A
              // changed key is a remount, and a remounted View is placed from
              // the current layout. The span's version is in it for the same
              // reason: a span re-cut to its line moves every pill after it
              // without changing the text, and bumps only those.
              key={`${key}c${pieceIndex}:${text.length}:${version}`}
              piece={piece}
              span={code}
              pieceIndex={pieceIndex}
              styles={styles}
              chipScale={pills.chipScale}
              table={pills.table}
              onPress={openFile}
            />
          )
        })
      } else {
        parts.push(
          <Text
            key={key}
            style={[styles.inlineCode, openFile ? styles.inlineCodeLink : null]}
            onPress={openFile}
            {...(openFile ? HOLD_DOES_NOT_OPEN : null)}
          >
            {code}
          </Text>
        )
      }
    } else if (token.startsWith('~~')) {
      parts.push(
        <Text key={key} style={styles.strike}>
          {renderInline(styles, token.slice(2, -2), onOpenFile, pills)}
        </Text>
      )
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(
        <Text key={key} style={styles.bold}>
          {renderInline(styles, token.slice(2, -2), onOpenFile, pills)}
        </Text>
      )
    } else {
      parts.push(
        <Text key={key} style={styles.italic}>
          {renderInline(styles, token.slice(1, -1), onOpenFile, pills)}
        </Text>
      )
    }
  }

  if (pendingStart < text.length) {
    parts.push(renderTextRun(styles, text.slice(pendingStart), `t${pendingStart}`, onOpenFile))
  }
  return parts
}

function MobileMarkdownInner({
  content,
  fallback = '',
  textScale = 1,
  onOpenFile,
  resolveImage,
  identity
}: Props) {
  const selectable = useChatTextSelectable()
  const styles = useMarkdownStyles()
  // The document's width, for figures drawn inline in the prose run (an
  // inline view needs a size of its own; see MobileMarkdownImage).
  const [contentWidth, setContentWidth] = useState(0)
  const text = content?.trim() ?? ''
  const previewText = useMemo(() => normalizeMobileMarkdownPreviewHtml(text), [text])
  const blocks = useMemo(() => parseMobileMarkdown(previewText), [previewText])
  // Prose and pill sizes move together; see mobile-markdown-prose-scale.ts for
  // why the line height is not simply `(size + 8) * scale`.
  const scaled = (size: number) => markdownProseScale(size, textScale)
  const proseScale = scaled(MARKDOWN_BASE_SIZE)
  const documentKey = useMemo(() => markdownDocumentKey(text), [text])
  const pillRuns = useMarkdownCodePillRuns(textScale, text, documentKey, identity)
  if (!text) {
    return fallback ? <Text style={styles.paragraph}>{fallback}</Text> : null
  }
  const mermaidSourceOccurrences = new Map<string, number>()

  // See mobile-markdown-prose-runs.ts for why the blocks group as they do.
  const runs = buildProseRuns(
    blocks,
    (url) => isRemoteImageUrl(url) || resolveImage !== undefined
  )

  const drawn = (
    <View
      style={styles.root}
      // A native view of the document's own, which everything it draws is
      // mounted into. On Android a Text keeps none of its inline Views, and a
      // View with only a gap and onLayout is flattened, so the pills and
      // Texts were mounted one by one into whatever stacking view held the
      // document (a chat list cell). Containment after an unexplained Fabric
      // "remove from a view that is not a ViewGroup" crash (2026-09-28): no
      // View between the two flattens today, but if one ever did it would
      // move them one by one, the kind of move react-native#57800 suspects.
      // Now they only move with this view (mobile-markdown-pill-native-parent.test.tsx).
      collapsable={false}
      onLayout={(event) => setContentWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {runs.map((run) => {
        const index = run.start
        const block = run.blocks[0]!
        if (run.prose) {
          const pills = pillRuns(`run:${index}`, contentWidth, false)
          const lastMember = run.prose.length - 1
          const members = run.prose.map((member, memberIndex) => {
            // The newline that ends a member is the member's own, set in its
            // line height; the blank line after it is the prose's. Android
            // lays a paragraph out at every line height its spans carry, and
            // RN places a pill from a layout that reads them in another order
            // than the one the words are drawn from, deep in a long Text
            // (mobile-markdown-pill-rows.test-support.ts). A heading ended by
            // the prose's newline was drawn at its own height and placed at
            // the prose's, and every pill below it rose by the difference,
            // half a line by the third heading (2026-09-28, HANDOVER.md).
            const end = memberIndex < lastMember ? '\n' : null
            return (
              <Fragment key={memberIndex}>
                {memberIndex > 0 ? '\n' : null}
                {member.type === 'heading' ? (
                  <Text style={headingStyle(styles, member.level, textScale)}>
                    {renderInline(styles, member.text, onOpenFile, pills)}
                    {end}
                  </Text>
                ) : member.type === 'rule' ? (
                  <Text style={styles.ruleText}>{RULE_TEXT}</Text>
                ) : member.type === 'list' ? (
                  member.items.map((item, itemIndex) => {
                    const marker = listMarker(item)
                    return (
                      <Fragment key={itemIndex}>
                        {itemIndex > 0 ? '\n' : null}
                        {LIST_INDENT_TEXT.repeat(item.depth)}
                        {marker ? (
                          <Text style={styles.listMarkerInline}>{`${marker}  `}</Text>
                        ) : null}
                        {renderInline(styles, item.text, onOpenFile, pills)}
                      </Fragment>
                    )
                  })
                ) : member.type === 'image' ? (
                  <MobileMarkdownImage
                    alt={member.alt}
                    url={member.url}
                    width={contentWidth}
                    resolve={resolveImage}
                    onOpen={() => openMarkdownHref(member.url, onOpenFile)}
                    styles={styles}
                  />
                ) : (
                  // One inline pass over the WHOLE paragraph. Matching line by
                  // line left `**bold` on one source line and `text**` on the
                  // next as literal asterisks on the phone (reported from the
                  // device); the parser has already reflowed soft wraps, so
                  // any newline left here is a deliberate hard break.
                  renderInline(styles, member.text, onOpenFile, pills)
                )}
                {member.type === 'heading' ? null : end}
              </Fragment>
            )
          })
          return (
            // `simple` is greedy breaking, as the Claude app lays out: a line
            // takes all that fits. Android's default balances lines, which
            // could break before a pill that fits and re-break the lines above
            // one. Only where a pill may be (a backtick); plain prose keeps
            // the default.
            <Text
              key={pills.keyFor(index)}
              selectable={selectable}
              style={[styles.paragraph, proseScale]}
              textBreakStrategy={pills.mayHoldPills() ? 'simple' : undefined}
              onTextLayout={pills.layoutReader()}
            >
              {members}
            </Text>
          )
        }
        if (block.type === 'image') {
          return (
            <View key={index} style={styles.figure}>
              <MobileMarkdownImage
                alt={block.alt}
                url={block.url}
                width={contentWidth}
                resolve={resolveImage}
                onOpen={() => openMarkdownHref(block.url, onOpenFile)}
                styles={styles}
              />
            </View>
          )
        }
        if (block.type === 'quote') {
          // One bar down the whole quote, text indented beside it, as the Claude
          // app draws it; see mobile-markdown-prose-runs.ts for why it is a View.
          const quoteWidth = contentWidth - styles.quoteBlock.borderLeftWidth - styles.quoteBlock.paddingLeft
          const pills = pillRuns(`quote:${index}`, Math.max(0, quoteWidth), false)
          const quoted = renderInline(styles, block.text, onOpenFile, pills)
          return (
            <View key={index} style={styles.quoteBlock}>
              <Text
                key={pills.keyFor('quote')}
                selectable={selectable}
                style={[styles.quoteText, proseScale]}
                textBreakStrategy={pills.mayHoldPills() ? 'simple' : undefined}
                onTextLayout={pills.layoutReader()}
              >
                {quoted}
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
          // A pill is cut to its own cell, as a paragraph's is to its line;
          // a paragraph's line is wider than a cell (2026-09-21).
          const cell = (rowKey: string, cellIndex: number, source: string, header: boolean) => {
            const width = columnWidths[cellIndex] ?? 0
            const inner = width - 2 * styles.tableCell.paddingHorizontal - styles.tableCell.borderRightWidth
            const pills = pillRuns(`table:${index}:${rowKey}:${cellIndex}`, inner, true)
            const children = renderInline(styles, source, onOpenFile, pills)
            return (
              // No width in a cell's key: its width moves only with the zoom,
              // which changes its pills' style too, so Fabric lays it out
              // anyway; a key that moved remounted every pill-holding cell on
              // every step of a pinch (review of c3e62696). A rotation leaves
              // a cell's width as it was: columns are sized from their text.
              <Text
                key={cellIndex}
                selectable={selectable}
                style={[
                  styles.tableCell,
                  header ? styles.tableHeader : null,
                  { width },
                  // The cell's text follows the zoom, as its column already
                  // does (computeTableColumnWidths) and its pills do.
                  markdownZoomedLine(styles.tableCell.fontSize, styles.tableCell.lineHeight, textScale)
                ]}
                textBreakStrategy={pills.mayHoldPills() ? 'simple' : undefined}
                onTextLayout={pills.layoutReader()}
              >
                {children}
              </Text>
            )
          }
          return (
            // A table that runs past the screen needs the same telling.
            <ScrollView key={index} horizontal showsHorizontalScrollIndicator persistentScrollbar>
              <View style={styles.table}>
                <View style={styles.tableRow}>
                  {columns.map((cellIndex) => cell('h', cellIndex, block.headers[cellIndex] ?? '', true))}
                </View>
                {visibleRows.map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.tableRow}>
                    {columns.map((cellIndex) => cell(String(rowIndex), cellIndex, row[cellIndex] ?? '', false))}
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
        return null
      })}
    </View>
  )
  // On Android, a native view around the document whose Texts copy a code
  // pill as its words, not U+FFFC (markdown-selection-copy.android.tsx).
  return <MarkdownSelectionRoot>{drawn}</MarkdownSelectionRoot>
}

export const MobileMarkdown = memo(MobileMarkdownInner)
