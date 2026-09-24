import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useThemedStyles, type Theme } from '../theme/theme-context'

/**
 * What a route switch paints while the hybrid shell flag is still being read, which is a
 * development or OTA build only: a store build cannot have the flag on and never reaches this.
 *
 * The base background and nothing else placed on it, so the frame before the decision looks like
 * the frame after it whichever way the decision goes. Lifted out of the `web` route, which is
 * where this exact view already was, rather than written again.
 *
 * Drawn from the theme, where upstream draws it from the static dark palette: the screen behind
 * it is a native one that follows the appearance setting, and a fixed colour flashed a dark frame
 * before every light screen. `HostProtocolGate`'s pending state, the surface above every switch,
 * is still the static palette.
 */
export function ShellSwitchPendingScreen() {
  const themed = useThemedStyles(pendingStyles)
  return (
    <View style={themed.styles.pending}>
      <ActivityIndicator color={themed.spinner} accessibilityLabel="Loading" />
    </View>
  )
}

function pendingStyles(theme: Theme) {
  return {
    spinner: theme.colors.textSecondary,
    styles: StyleSheet.create({
      pending: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.bg
      }
    })
  }
}
