import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/**
 * A file card as the Claude app draws one (com.anthropic.claude 1.261009.20,
 * decompiled): `f0f.f` lays it out as a 96 dp square (`kvc(96)` at
 * m330.java:6350), clipped to `bn7.h` (16 dp), a 1 dp border in `pl7.w`, fill
 * `pl7.p`, 8 dp padding; the extension badge at the top start, a weighted
 * spacer, the name at the bottom. The badge (`f0f.g`, hvc case 10) is a
 * Surface in `bn7.d` (8 dp) with a hairline `pl7.w` border, the extension
 * upper-cased in `jn7.L` (11 / 550 / 16.5) with 6 x 2 dp padding, one line.
 * The name (`f0f.c`) is `jn7.H` (13 / 400 / 18.2) in `pl7.P`, start-aligned,
 * at most three lines.
 *
 * One departure: the card is wider than 96. Instrument Sans sets a recording
 * name about a fifth wider than Anthropic Sans, so in 80 dp of text a
 * 40-character name ("Screen_Recording_20261014_133056_Code_UI") took four
 * lines and was cut, where the Claude app fits it in three. 100 dp of text
 * fits it in three (priced with the font's own advances in
 * MobileNativeChatMessage.test.ts). The height stays the app's 96, which is
 * the badge and three lines of name with no empty space under them.
 *
 * Kept out of `mobile-native-chat-message-styles.ts`, which is at its line cap.
 */
const CARD_WIDTH = 116
const CARD_HEIGHT = 96

export function makeFileCardStyles(theme: Theme) {
  const { colors, fonts } = theme
  return StyleSheet.create({
    /** The cards above a prompt: one row, end-aligned, 8 dp apart, scrolling
     *  sideways when there are more than fit (m330.java:7339-7344). */
    uploadRow: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      gap: 8
    },
    uploadScroll: {
      alignSelf: 'stretch',
      flexGrow: 0,
      marginBottom: 8
    },
    /** The agent's sent files inside its reply: the same cards, wrapping. */
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.attachmentCardBorder,
      backgroundColor: colors.attachmentCardFill,
      padding: 8,
      overflow: 'hidden'
    },
    pressed: {
      opacity: 0.7
    },
    /** An attached photo: the picture itself at 96 x 96, clipped to the same 16 dp
     *  (m330.java:6350, the `jd2Var != null` branch of m330.c). */
    thumb: {
      width: CARD_HEIGHT,
      height: CARD_HEIGHT,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: colors.attachmentCardFill
    },
    thumbImage: {
      width: CARD_HEIGHT,
      height: CARD_HEIGHT
    },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.attachmentCardBorder,
      backgroundColor: colors.attachmentCardFill,
      paddingHorizontal: 6,
      paddingVertical: 2
    },
    badgeText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      lineHeight: 16.5,
      letterSpacing: 0,
      color: colors.attachmentCardText
    },
    spacer: {
      flex: 1
    },
    name: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18.2,
      letterSpacing: 0,
      color: colors.attachmentCardText
    }
  })
}

export type FileCardStyles = ReturnType<typeof makeFileCardStyles>

export function useFileCardStyles(): FileCardStyles {
  const theme = useTheme()
  return useMemo(() => makeFileCardStyles(theme), [theme])
}
