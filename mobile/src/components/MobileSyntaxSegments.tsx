import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import type { MobileSyntaxSegment, MobileSyntaxTokenKind } from '../session/mobile-file-syntax'
import { darkSyntaxPalette, SYNTAX_TOKEN_ROLES, type SyntaxPalette } from '../theme/syntax-palette'
import { fontFamily } from '../theme/tokens'

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
  palette,
  onLongPress,
  onPress
}: {
  number: number
  segments: MobileSyntaxSegment[]
  /** The code colours; `useTheme().syntax` on a themed surface. */
  palette?: SyntaxPalette
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
        <MobileSyntaxSegments segments={segments} palette={palette} />
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

export function MobileSyntaxSegments({
  segments,
  palette = darkSyntaxPalette
}: {
  segments: MobileSyntaxSegment[]
  /** Defaults to Dark+ for the surfaces still painted from the static dark
   *  palette (the diff rows). A themed surface passes `useTheme().syntax`. */
  palette?: SyntaxPalette
}) {
  const styles = syntaxSpanStyles(palette)
  return (
    <>
      {segments.map((segment, index) => (
        <Text key={`${index}:${segment.kind}`} style={styles[segment.kind]}>
          {segment.text}
        </Text>
      ))}
    </>
  )
}

const spanStylesByPalette = new WeakMap<SyntaxPalette, Record<MobileSyntaxTokenKind, TextStyle>>()

/** One style per role, each naming the code face. Why the face on every span:
 *  the React Native patch gives any Text that names no face Instrument Sans
 *  (instrument-sans-text.ts), and a nested span is a Text, so a span with only
 *  a colour drew the UI face inside a monospace line. That was the
 *  proportional code in the 2026-09-19 and 2026-09-26 screenshots, not the
 *  Samsung font swap. */
export function syntaxSpanStyles(palette: SyntaxPalette): Record<MobileSyntaxTokenKind, TextStyle> {
  const cached = spanStylesByPalette.get(palette)
  if (cached) {
    return cached
  }
  const styles = StyleSheet.create(
    Object.fromEntries(
      SYNTAX_TOKEN_ROLES.map((role) => [role, { color: palette[role], fontFamily: fontFamily.mono }])
    ) as Record<MobileSyntaxTokenKind, TextStyle>
  )
  spanStylesByPalette.set(palette, styles)
  return styles
}
