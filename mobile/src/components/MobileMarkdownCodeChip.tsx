import { Text, View } from 'react-native'
import { useChatTextSelectable } from './chat-text-selectable-context'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import type { MarkdownStyles } from './mobile-markdown-styles'
import type { markdownChipScale } from './mobile-markdown-prose-scale'

/**
 * One inline code pill: a real inline View, the only way Android rounds and
 * borders a chip. It cannot break across lines, so a long span is several
 * pills that wrap (mobile-markdown-code-chip-split.ts).
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
  onPress
}: {
  piece: string
  styles: MarkdownStyles
  /** Pill sizes at the reader's zoom; null when they have not zoomed. */
  chipScale: ReturnType<typeof markdownChipScale> | undefined
  /** Opens the file a path pill names; a tap, never a hold (markdown-link-hold.ts). */
  onPress?: () => void
}) {
  const selectable = useChatTextSelectable()
  return (
    <View
      // A plain object when the reader has not zoomed: an array per chip costs
      // an allocation on every render of every message, and it hides
      // `borderRadius` from anything reading the style.
      style={
        chipScale
          ? [
              styles.inlineCodeChip,
              { paddingVertical: chipScale.paddingVertical, borderRadius: chipScale.borderRadius }
            ]
          : styles.inlineCodeChip
      }
    >
      <Text
        selectable={selectable}
        style={[
          styles.inlineCodeChipText,
          chipScale ? { fontSize: chipScale.fontSize, lineHeight: chipScale.lineHeight } : null,
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
