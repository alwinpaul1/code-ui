import { useMemo } from 'react'
import { Text, View, type TextStyle } from 'react-native'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import { useTheme } from '../theme/theme-context'
import { codeTextRuns } from './mobile-markdown-code-runs'
import { MobileSyntaxSegments } from './MobileSyntaxSegments'

/**
 * A block's code as the Claude app lays it out: one line per source line, no
 * line numbers, and no wrapping (the caller scrolls it sideways). Twenty-four
 * lines to a Text, as the app does, so a hold selects across a whole run and a
 * long block mounts a twenty-fourth of the views the one-Text-a-line version
 * did. `lineStyle` carries the size and line height; the colours are the live
 * theme's code palette.
 */
export function MarkdownCodeText({
  lines,
  lineStyle,
  selectable
}: {
  lines: readonly MobileSyntaxSegment[][]
  lineStyle: TextStyle
  selectable: boolean
}) {
  const { syntax } = useTheme()
  const runs = useMemo(() => codeTextRuns(lines), [lines])
  // The line's own face, which is the reader's code font in the transcript: each span names a face
  // of its own and would otherwise keep the bundled one.
  const family = lineStyle.fontFamily
  return (
    <View>
      {runs.map((run, index) => (
        <Text key={index} selectable={selectable} style={lineStyle}>
          <MobileSyntaxSegments segments={run} palette={syntax} family={family} />
        </Text>
      ))}
    </View>
  )
}
