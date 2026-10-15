import { View } from 'react-native'

/**
 * The working footer's " · ", drawn rather than typed. The Claude app sets
 * `ccr_spark_segment_separator` (" · ") in its own font, whose middle dot is a square; in Instrument
 * Sans the same character is a round dot (2026-10-16, from the device: "In between each component
 * there should square shaped dot exactly square shaped"). So the dot is a square a fifth of the
 * text size, in the text's colour, with a space's width (about a quarter of the size) either side,
 * nudged down a little from the line's middle to where the font's dot sits.
 */
export function ClaudeFooterSeparator({ color, fontSize }: { color: string; fontSize: number }) {
  const side = Math.max(2, Math.round(fontSize * 0.2))
  return (
    <View
      testID="claude-footer-separator"
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={{
        width: side,
        height: side,
        backgroundColor: color,
        marginHorizontal: Math.round(fontSize * 0.27),
        transform: [{ translateY: Math.round(fontSize * 0.07) }]
      }}
    />
  )
}
