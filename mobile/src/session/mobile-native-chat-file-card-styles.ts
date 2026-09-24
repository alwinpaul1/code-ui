import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** A file Claude Code recorded as an `@"<path>"` mention (docs/claude-app-
 *  parity.md item 9): a card the same footprint as an image tile, so the two
 *  sit at a matching height when a message carries both, with the extension
 *  badge above the name — the Claude app's own layout. Kept out of
 *  `mobile-native-chat-message-styles.ts`, which is already at its line cap. */
const CARD_WIDTH = 132
const CARD_MIN_HEIGHT = 176

export function makeFileCardStyles(theme: Theme) {
  const { colors, radius, space } = theme
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm
    },
    card: {
      width: CARD_WIDTH,
      minHeight: CARD_MIN_HEIGHT,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised,
      padding: space.md,
      gap: space.sm,
      alignItems: 'flex-start'
    },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel,
      paddingHorizontal: space.sm + 2,
      paddingVertical: 4
    },
    badgeText: {
      color: colors.textSecondary
    },
    name: {
      color: colors.text
    }
  })
}

export type FileCardStyles = ReturnType<typeof makeFileCardStyles>

export function useFileCardStyles(): FileCardStyles {
  const theme = useTheme()
  return useMemo(() => makeFileCardStyles(theme), [theme])
}
