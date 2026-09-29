import { Text, View } from 'react-native'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import { pillCopyNativeId } from './markdown-selection-copy'
import { markdownScreenDensity, type MarkdownStyles } from './mobile-markdown-styles'
import { systemSpScale } from './system-font-scale'
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
 * A hold on the pill is the prose's. The pill is drawn over the prose Text
 * as a separate view, and on Android a React view consumes every touch that
 * lands on it, so a hold on the pill never reached the prose and selected
 * nothing (2026-09-25). Making the pill's own Text selectable gave a
 * selection that could not leave the pill, its handles drawn a line low
 * (2026-09-29, the user: "I can't move that copy thingy sideways to copy
 * other things"). So the View is `box-none` and its Text is not selectable:
 * neither consumes the touch natively, the hold falls to the prose Text under
 * it, and that selection starts on the pill's U+FFFC with handles that run
 * across the paragraph. A Copy puts the pill's words in place of the U+FFFC:
 * the pill's View carries its span on its nativeID (markdown-pill-copy-id.ts).
 * The Text is still the JS touch target, since React Native's hit test skips
 * only the `box-none` View itself, so a file pill opens on a tap.
 */
export function MobileMarkdownCodeChip({
  piece,
  span,
  pieceIndex,
  styles,
  chipScale,
  table,
  onPress
}: {
  piece: string
  /** The whole code span `piece` was cut from, which a Copy puts in place of the pill. */
  span: string
  /** This pill's place in its span: 0 for the first of the lines it crosses. */
  pieceIndex: number
  styles: MarkdownStyles
  /** Pill sizes at the reader's zoom; null when they have not zoomed. */
  chipScale: MarkdownChipScale | null
  /** In a table cell, whose type is a step smaller than a paragraph's. */
  table: boolean
  /** Opens the file a path pill names; a tap, never a hold (markdown-link-hold.ts). */
  onPress?: () => void
}) {
  // The room for ink grows with the type, in whole pixels (see the style).
  const inkRoom = chipScale ? markdownChipInkRoom(markdownScreenDensity(), chipScale.factor, systemSpScale().toDp) : null
  return (
    <View
      nativeID={pillCopyNativeId(span, pieceIndex)}
      pointerEvents="box-none"
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
