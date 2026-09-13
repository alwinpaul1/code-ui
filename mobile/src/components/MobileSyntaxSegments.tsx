import { StyleSheet, Text, type TextStyle } from 'react-native'
import type { MobileSyntaxSegment, MobileSyntaxTokenKind } from '../session/mobile-file-syntax'
import { colors } from '../theme/mobile-theme'

/** One numbered source line: the gutter, then the line's coloured segments. */
export function MobileSyntaxLine({
  number,
  segments,
  gutterWidth,
  lineStyle,
  gutterStyle
}: {
  number: number
  segments: MobileSyntaxSegment[]
  gutterWidth: number
  lineStyle: TextStyle
  gutterStyle: TextStyle
}) {
  return (
    <Text selectable style={lineStyle}>
      <Text selectable={false} style={[gutterStyle, { width: gutterWidth }]}>
        {String(number).padStart(3, ' ') + '  '}
      </Text>
      <MobileSyntaxSegments segments={segments} />
    </Text>
  )
}

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
