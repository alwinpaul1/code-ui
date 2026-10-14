import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'
import { useChatReadingSettings } from '../settings/chat-reading-settings'

/**
 * What a code block's lines sit in: a sideways scroller, or, with the reader's "Wrap long lines"
 * on (`code_line_wrap_enabled`, default off), a plain box the lines break inside.
 *
 * Off is the card as it has been, and as the Claude app has it (code-block-spec.ts, w330.java:182):
 * a line wider than the card scrolls, because wrapping a command or an indented block shreds it.
 * The bar is SHOWN and kept on Android, so a line the phone cannot fit reads as scrollable and not
 * as cut off (reported 2026-09-15: a gate command ended at "npx" and looked truncated).
 *
 * On, the same padding sits around the code and a long line continues on the next row. A Text
 * breaks at the box's width by itself, so nothing is measured here. The card and its Expand sheet
 * both use this, so the switch moves both, live: it is read from the settings store, not passed
 * down, and an open chat follows the Settings screen without a remount.
 */
export function MarkdownCodeScroller({
  contentStyle,
  children
}: {
  /** The padding around the code. */
  contentStyle: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const { wrapLongLines } = useChatReadingSettings()
  if (wrapLongLines) {
    return <View style={contentStyle}>{children}</View>
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      persistentScrollbar
      contentContainerStyle={contentStyle}
    >
      {children}
    </ScrollView>
  )
}
