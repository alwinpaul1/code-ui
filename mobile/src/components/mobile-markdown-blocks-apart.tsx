import type { ReactNode } from 'react'
import { Text, View, type TextStyle } from 'react-native'
import type { MarkdownStyles } from './mobile-markdown-styles'
import type { MarkdownTypography } from './mobile-markdown-prose-scale'
import type { ProseBlock } from './mobile-markdown-prose-runs'
import type { CodePillRun } from './use-markdown-code-pill-runs'
import { listMarker } from './mobile-markdown-list-marker'
import { systemSpScale } from './system-font-scale'

/** The same indent the prose run gives a nested item in spaces, in dp. */
const LIST_INDENT_DP = 16
/** JetBrains Mono, the list marker's face: 600 of 1000 units a glyph. */
const MONO_ADVANCE_EM = 0.6
/** An item's words beside its marker take the rest of the row. */
const LIST_ITEM_TEXT = { flex: 1, minWidth: 0 } as const

/** What a document lends the blocks it draws apart. */
export type BlocksApartContext = {
  styles: MarkdownStyles
  typography: MarkdownTypography
  textScale: number
  /** Prose size and line at the reader's zoom; null at no zoom. */
  proseScale: { fontSize: number; lineHeight: number } | null
  contentWidth: number
  selectable: boolean
  pillRuns: (textKey: string, lineWidth: number, table: boolean) => CodePillRun
  inline: (text: string, pills: CodePillRun) => ReactNode
  headingStyle: (level: number) => unknown
  /** An image link inside a line of prose (MobileMarkdownImage). */
  image: (member: Extract<ProseBlock, { type: 'image' }>) => ReactNode
}

/** One Text of prose, its pills cut to `width`. The pill run's key, break
 *  strategy and layout reader are asked once its children are drawn
 *  (use-markdown-code-pill-runs.ts). */
function proseText(
  ctx: BlocksApartContext,
  pillKey: string,
  width: number,
  style: unknown,
  text: string
): ReactNode {
  const pills = ctx.pillRuns(pillKey, width, false)
  const children = ctx.inline(text, pills)
  return (
    <Text
      key={pills.keyFor(pillKey)}
      selectable={ctx.selectable}
      style={[ctx.styles.paragraph, ctx.proseScale, style as TextStyle]}
      textBreakStrategy={pills.mayHoldPills() ? 'simple' : undefined}
      onTextLayout={pills.layoutReader()}
    >
      {children}
    </Text>
  )
}

/**
 * A block of a prose run as a Text of its own, where nothing needs the run
 * to be one Text (the Android chat transcript, which has no inline selection:
 * Orca #22871). The document's gap sets the blocks apart, as the Claude app
 * sets its paragraphs about 7 dp apart, where the run puts a whole blank line
 * between them; and a list is rows whose wrapped lines hang under their words,
 * as the Claude app draws a bullet, its items 4 dp apart (2026-10-09).
 */
export function drawProseBlockApart(ctx: BlocksApartContext, member: ProseBlock, key: string): ReactNode {
  switch (member.type) {
    case 'heading':
      return proseText(ctx, `apart:${key}`, ctx.contentWidth, ctx.headingStyle(member.level), member.text)
    case 'rule':
      return <View key={key} style={ctx.styles.rule} />
    case 'image':
      return (
        <Text key={key} selectable={ctx.selectable} style={[ctx.styles.paragraph, ctx.proseScale]}>
          {ctx.image(member)}
        </Text>
      )
    case 'paragraph':
      return proseText(ctx, `apart:${key}`, ctx.contentWidth, null, member.text)
    case 'list': {
      // The marker is mono, every glyph 0.6 em, so its column is known before
      // layout and each item's pills are cut to the room beside it. One column
      // for the whole list, as wide as its widest marker and a space, so the
      // words of item 10 start where item 9's do, and a continued item (no
      // marker of its own) hangs under them too. The marker and its column
      // keep their size at any pinch: an item whose width moved with the zoom
      // was keyed anew and remounted at every step (keyFor). A glyph JetBrains
      // Mono lacks (◦, ☐, ☑) comes from a fallback; the space's advance is its
      // slack.
      const markerAdvance = systemSpScale().toDp(ctx.typography.listMarkerSize) * MONO_ADVANCE_EM
      const widest = Math.max(0, ...member.items.map((item) => listMarker(item).length))
      const markerWidth = widest > 0 ? markerAdvance * (widest + 1) : 0
      const lineHeight = ctx.proseScale?.lineHeight ?? ctx.typography.prose.lineHeight
      return (
        <View key={key} style={{ gap: ctx.typography.listItemGap * ctx.textScale }}>
          {member.items.map((item, itemIndex) => {
            const marker = listMarker(item)
            const indent = item.depth * LIST_INDENT_DP
            return (
              <View key={itemIndex} style={{ flexDirection: 'row', paddingLeft: indent }}>
                {markerWidth > 0 ? (
                  <Text selectable={ctx.selectable} style={[ctx.styles.listMarkerInline, { width: markerWidth, lineHeight }]}>
                    {marker}
                  </Text>
                ) : null}
                {proseText(
                  ctx,
                  `apart:${key}:${itemIndex}`,
                  Math.max(0, ctx.contentWidth - indent - markerWidth),
                  LIST_ITEM_TEXT,
                  item.text
                )}
              </View>
            )
          })}
        </View>
      )
    }
    default: {
      const unhandled: never = member
      return unhandled
    }
  }
}
