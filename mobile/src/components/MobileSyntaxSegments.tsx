import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import type { MobileSyntaxSegment, MobileSyntaxTokenKind } from '../session/mobile-file-syntax'
import { colors } from '../theme/mobile-theme'
import { lightColors, type ThemeScheme } from '../theme/tokens'

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

/**
 * A line's coloured segments. `scheme` picks the palette for the surface underneath, not the app's
 * appearance: the session file reader, diffs and fenced blocks draw on the static dark editor
 * surface in both themes, so they keep the default. The file preview's source text sits on the
 * themed page and passes the live scheme.
 */
export function MobileSyntaxSegments({
  segments,
  scheme = 'dark'
}: {
  segments: MobileSyntaxSegment[]
  scheme?: ThemeScheme
}) {
  const tokenStyles = scheme === 'light' ? lightSyntaxTokenStyles : syntaxTokenStyles
  return (
    <>
      {segments.map((segment, index) => (
        <Text key={`${index}:${segment.kind}`} style={tokenStyles[segment.kind]}>
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

/**
 * The same token kinds for a light surface. VS Code's Light+ hues, darkened where Light+ falls under
 * 4.5:1 on the warm canvas (its number and type greens and teal measure 4.1:1 on #F3F1EA). Every
 * one clears 4.5:1 on lightColors.bg, codeBg and bgPanel (mobile-file-preview-light-dark.test.tsx
 * measures them on the page it is drawn on).
 */
const LIGHT_SYNTAX = {
  comment: '#34702A',
  keyword: '#1A4FD6',
  string: '#A31515',
  number: '#0B6E4F',
  type: '#1F6A80',
  function: '#795E26',
  variable: '#1F3A93',
  meta: '#8E24AA'
} as const

const lightSyntaxTokenStyles: Record<MobileSyntaxTokenKind, TextStyle> = StyleSheet.create({
  plain: {
    color: lightColors.text
  },
  comment: {
    color: LIGHT_SYNTAX.comment
  },
  keyword: {
    color: LIGHT_SYNTAX.keyword
  },
  string: {
    color: LIGHT_SYNTAX.string
  },
  number: {
    color: LIGHT_SYNTAX.number
  },
  type: {
    color: LIGHT_SYNTAX.type
  },
  function: {
    color: LIGHT_SYNTAX.function
  },
  variable: {
    color: LIGHT_SYNTAX.variable
  },
  meta: {
    color: LIGHT_SYNTAX.meta
  }
})
