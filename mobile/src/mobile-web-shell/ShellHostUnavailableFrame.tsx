import { StyleSheet, Text, View } from 'react-native'
import { spacing, typography } from '../theme/mobile-theme'
import { useThemedStyles, type Theme } from '../theme/theme-context'

/**
 * What the shell shows in place of the page while this desktop's profile cannot be read: a locked
 * or failing Keychain, a credential that is gone, or a catalog read that rejected.
 *
 * No host is built without that profile, so a mounted page would sit behind its cover with nothing
 * to answer its `ready` (review, 2026-09-30). Nothing to tap: the snapshot is read again on the
 * next connection and the page mounts then, and the message itself says what to do if it does not.
 */
export function ShellHostUnavailableFrame({ message }: { message: string }) {
  const styles = useThemedStyles(shellHostUnavailableStyles)
  return (
    <View style={styles.frame} testID="mobile-web-shell-host-unavailable">
      <Text style={styles.message}>{message}</Text>
    </View>
  )
}

function shellHostUnavailableStyles({ colors }: Theme) {
  return StyleSheet.create({
    frame: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
      paddingHorizontal: spacing.lg
    },
    message: {
      fontSize: typography.bodySize,
      color: colors.text,
      textAlign: 'center'
    }
  })
}
