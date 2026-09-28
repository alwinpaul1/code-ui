import { Text, View } from 'react-native'
import { useChatTextSelectable } from './chat-text-selectable-context'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import { markdownScreenDensity, type MarkdownStyles } from './mobile-markdown-styles'
import { systemSpScale } from './system-font-scale'
import { markdownChipGeometry, markdownChipInkRoom, type MarkdownChipScale } from './mobile-markdown-prose-scale'

/**
 * One inline code pill: a real inline View, the only way Android rounds and
 * borders a chip. It cannot break across lines, so a span is one pill per
 * line it crosses, the first cut to the room left on its line
 * (mobile-markdown-code-chip-split.ts).
 *
 * Two Views. The one the Text holds is the frame Android lays out on the
 * line, no taller than the words' ascent less their descent, so a pill takes
 * no room a line of words does not already have (markdownChipGeometry). The
 * pill is the View inside it, which runs out of the frame's bottom and is
 * drawn up so its text sits on the words' baseline. Its text is set from the
 * words around it, a paragraph's, a heading's or a cell's.
 *
 * The frame carries its height and nothing else, so Fabric flattens it and
 * mounts the pill as the native view, with the pill's own bounds and shift
 * (ViewShadowNode.cpp: a transform or a border forms a view, a height does
 * not). The shift was the frame's, which made the frame a native view as
 * short as itself; Android hit-tests a child only inside its parent
 * (ViewGroup.dispatchTouchEvent), and a hold on the lower 40% of a pill, 69%
 * at 200%, fell through to the prose under it (review of 2ebd5ce6).
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
  words,
  onPress
}: {
  piece: string
  styles: MarkdownStyles
  /** Pill padding and corners at the reader's zoom; null when they have not
   *  zoomed. */
  chipScale: MarkdownChipScale | null
  /** The words around the pill: their type size and line height, in sp at
   *  the reader's zoom. */
  words: { fontSize: number; lineHeight: number }
  /** Opens the file a path pill names; a tap, never a hold (markdown-link-hold.ts). */
  onPress?: () => void
}) {
  const selectable = useChatTextSelectable()
  const sp = systemSpScale()
  const geometry = markdownChipGeometry(words.fontSize, sp, words.lineHeight)
  // The room for ink grows with the type, in whole pixels (see the style).
  const inkRoom = markdownChipInkRoom(markdownScreenDensity(), 1, sp.toDp, [[geometry.fontSize, geometry.lineHeight]])
  return (
    <View style={{ height: geometry.frame }}>
      <View
        // One plain object: it keeps `borderRadius` in reach of anything
        // reading the style.
        style={{
          ...styles.inlineCodeChip,
          ...(chipScale
            ? {
                paddingVertical: chipScale.paddingVertical,
                paddingHorizontal: chipScale.paddingHorizontal,
                borderRadius: chipScale.borderRadius
              }
            : null),
          transform: [{ translateY: geometry.shift }]
        }}
      >
        <Text
          selectable={selectable}
          style={[
            styles.inlineCodeChipText,
            {
              fontSize: geometry.fontSize,
              lineHeight: geometry.lineHeight,
              paddingTop: inkRoom.top,
              paddingBottom: inkRoom.bottom,
              marginTop: -inkRoom.top,
              marginBottom: -inkRoom.bottom
            },
            onPress ? styles.inlineCodeLink : null
          ]}
          onPress={onPress}
          {...(onPress ? HOLD_DOES_NOT_OPEN : null)}
        >
          {piece}
        </Text>
      </View>
    </View>
  )
}
