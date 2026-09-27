import { Text, View } from 'react-native'
import { useChatTextSelectable } from './chat-text-selectable-context'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import { markdownScreenDensity, markdownSpScale, type MarkdownStyles } from './mobile-markdown-styles'
import {
  MARKDOWN_TABLE_CHIP_FONT_SIZE,
  MARKDOWN_TABLE_CHIP_LINE_HEIGHT,
  markdownChipInkRoom,
  type MarkdownChipScale
} from './mobile-markdown-prose-scale'

/**
 * One inline code pill: a real inline View, the only way Android rounds and
 * borders a chip. It cannot break across lines, so a span is one pill per
 * line it crosses, the first cut to the room left on its line
 * (mobile-markdown-code-chip-split.ts).
 *
 * Its Text is selectable on its own, under the same scroll gate as the prose.
 * The pill is drawn over the prose Text as a separate view, and on Android a
 * React view consumes every touch that lands on it, so a hold on the pill
 * never reached the prose under it and selected nothing (2026-09-25). A
 * selection still cannot cross from the prose into a pill or out of it; the
 * message's copy button carries the whole reply.
 */
export function MobileMarkdownCodeChip({
  piece,
  styles,
  chipScale,
  table,
  onPress
}: {
  piece: string
  styles: MarkdownStyles
  /** Pill sizes at the reader's zoom; null when they have not zoomed. */
  chipScale: MarkdownChipScale | null
  /** In a table cell, whose type is a step smaller than a paragraph's. */
  table: boolean
  /** Opens the file a path pill names; a tap, never a hold (markdown-link-hold.ts). */
  onPress?: () => void
}) {
  const selectable = useChatTextSelectable()
  // The room for ink grows with the type, in whole pixels (see the style).
  const inkRoom = chipScale ? markdownChipInkRoom(markdownScreenDensity(), chipScale.factor, markdownSpScale().toDp) : null
  return (
    <View
      // A plain object when the reader has not zoomed: an array per chip costs
      // an allocation on every render of every message, and it hides
      // `borderRadius` from anything reading the style.
      style={
        chipScale
          ? [
              styles.inlineCodeChip,
              {
                paddingVertical: chipScale.paddingVertical,
                paddingHorizontal: chipScale.paddingHorizontal,
                borderRadius: chipScale.borderRadius,
                transform: [{ translateY: chipScale.baselineShift }]
              }
            ]
          : styles.inlineCodeChip
      }
    >
      <Text
        selectable={selectable}
        style={[
          styles.inlineCodeChipText,
          table ? styles.inlineCodeChipTextTable : null,
          chipScale
            ? table
              ? {
                  fontSize: MARKDOWN_TABLE_CHIP_FONT_SIZE * chipScale.factor,
                  lineHeight: MARKDOWN_TABLE_CHIP_LINE_HEIGHT * chipScale.factor
                }
              : { fontSize: chipScale.fontSize, lineHeight: chipScale.lineHeight }
            : null,
          inkRoom
            ? {
                paddingTop: inkRoom.top,
                paddingBottom: inkRoom.bottom,
                marginTop: -inkRoom.top,
                marginBottom: -inkRoom.bottom
              }
            : null,
          onPress ? styles.inlineCodeLink : null
        ]}
        onPress={onPress}
        {...(onPress ? HOLD_DOES_NOT_OPEN : null)}
      >
        {piece}
      </Text>
    </View>
  )
}
