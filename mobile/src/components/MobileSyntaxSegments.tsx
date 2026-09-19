import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import type { MobileSyntaxSegment, MobileSyntaxTokenKind } from '../session/mobile-file-syntax'
import { colors } from '../theme/mobile-theme'

/** One numbered source line: the gutter in its own column, then the line's
 *  coloured segments beside it. A row, not one Text with the number as a span:
 *  a span has no column, so a line that wrapped went back to column zero
 *  under its number and the file read as prose (screenshot, 2026-09-19). Beside
 *  a fixed gutter, a wrapped line continues under its own first character. */
export function MobileSyntaxLine({
  number,
  segments,
  gutterWidth,
  gutterDigits = 3,
  lineStyle,
  gutterStyle,
  selectable = true,
  highlighted = false,
  highlightStyle,
  onLongPress,
  onPress
}: {
  number: number
  segments: MobileSyntaxSegment[]
  gutterWidth: number
  /** False while a list is scrolling: a selectable Text under a finger that
   *  stops a fling arms a long-press the reader did not ask for, which
   *  MobileMarkdown.selection.test.ts pins. The file reader keeps the default. */
  selectable?: boolean
  /** Digits in the file's LAST line number. A fixed 3 shifted every line from
   *  1000 onward, because a nested `Text` ignores `width` (2026-09-13). */
  gutterDigits?: number
  lineStyle: TextStyle
  gutterStyle: TextStyle
  /** True while this line sits inside the file reader's line-selection range
   *  (Alt+K parity); paints `highlightStyle` behind the row. */
  highlighted?: boolean
  highlightStyle?: TextStyle
  /** Starts/extends a line selection. Left undefined, the line behaves exactly
   *  as it always has — no touch handling added, `selectable` still governs
   *  the OS's own copy gesture. Defined, `Text`'s own touch handling takes the
   *  long-press instead of arming native selection (2026-09-18; unverified on
   *  a physical device — see MobileSessionFileReader's line-selection notes). */
  onLongPress?: () => void
  onPress?: () => void
}) {
  return (
    <View style={highlighted ? [lineStyles.row, highlightStyle] : lineStyles.row}>
      <Text
        selectable={false}
        style={[lineStyle, gutterStyle, lineStyles.gutter, { width: gutterWidth }]}
        onLongPress={onLongPress}
        onPress={onPress}
      >
        {String(number).padStart(gutterDigits, ' ')}
      </Text>
      <Text
        selectable={selectable}
        style={[lineStyle, lineStyles.code]}
        onLongPress={onLongPress}
        onPress={onPress}
      >
        <MobileSyntaxSegments segments={segments} />
      </Text>
    </View>
  )
}

const lineStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  gutter: {
    textAlign: 'right',
    paddingRight: 10
  },
  code: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0
  }
})

export function MobileSyntaxSegments({ segments }: { segments: MobileSyntaxSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Text key={`${index}:${segment.kind}`} style={syntaxTokenStyles[segment.kind]}>
          {segment.text}
        </Text>
      ))}
    </>
  )
}

const syntaxTokenStyles: Record<MobileSyntaxTokenKind, TextStyle> = StyleSheet.create({
  plain: {
    color: colors.textPrimary
  },
  comment: {
    color: colors.syntaxComment
  },
  keyword: {
    color: colors.syntaxKeyword
  },
  string: {
    color: colors.syntaxString
  },
  number: {
    color: colors.syntaxNumber
  },
  type: {
    color: colors.syntaxType
  },
  function: {
    color: colors.syntaxFunction
  },
  variable: {
    color: colors.syntaxVariable
  },
  meta: {
    color: colors.syntaxMeta
  }
})
