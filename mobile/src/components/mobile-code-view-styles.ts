import { StyleSheet } from 'react-native'
import type { Theme } from '../theme/theme-context'
import { CODE_VIEW_PADDING_START, type CodeViewMetrics } from './mobile-code-view-layout'

/** The code viewer's styles, from the live theme and the grid. Every colour
 *  is a theme token: the surface and the code follow the appearance setting. */
export function makeCodeViewStyles(theme: Pick<Theme, 'colors' | 'syntax' | 'fonts'>, metrics: CodeViewMetrics) {
  const { colors, syntax, fonts } = theme
  const code = {
    fontFamily: fonts.mono,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight
  }
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
      backgroundColor: syntax.surface
    },
    notice: {
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textMuted,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    area: {
      flex: 1,
      minHeight: 0
    },
    sideways: {
      flex: 1
    },
    sidewaysContent: {
      // At least as wide as the screen, so a short file still fills it.
      flexGrow: 1
    },
    list: {
      flexGrow: 1
    },
    listContent: {
      paddingTop: 8,
      paddingBottom: 32,
      paddingLeft: CODE_VIEW_PADDING_START
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start'
    },
    gutter: {
      ...code,
      width: metrics.gutterWidth,
      paddingRight: metrics.gutterWidth - metrics.gutterDigits * metrics.cellWidth,
      textAlign: 'right',
      color: syntax.gutter
    },
    gutterSelected: {
      color: syntax.gutterActive
    },
    code: {
      flex: 1,
      minWidth: 0
    },
    codeText: {
      ...code,
      color: syntax.plain
    },
    guide: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: syntax.indentGuide
    },
    toolbar: {
      position: 'absolute',
      top: 8,
      right: 8,
      flexDirection: 'row',
      gap: 8
    },
    toolButton: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    toolButtonWide: {
      width: 'auto',
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 10
    },
    toolLabel: {
      fontFamily: fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary
    },
    toolButtonOn: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent
    }
  })
}

export type CodeViewStyles = ReturnType<typeof makeCodeViewStyles>
