import { StyleSheet, View } from 'react-native'
import { useTheme } from '../../theme/theme-context'

/**
 * The hairline between an alert's header and its content.
 *
 * The action rows draw their own top border, so this is only for the seam a row
 * cannot draw: under the title block, where the card turns from what it is
 * telling you into what it is showing you. Without it the release notes ran
 * straight out of the subtitle as one column of text.
 *
 * `alertSeparator`, not `border`: the card's material is translucent, so a
 * palette hex is only right over one backdrop. See tokens.ts.
 */
export function AlertSeparator() {
  const { colors } = useTheme()
  return (
    <View
      // Not focusable and not announced: it is a seam, and a screen reader
      // stopping on it would read an empty row between two it already reads.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignSelf: 'stretch',
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.alertSeparator
      }}
    />
  )
}
