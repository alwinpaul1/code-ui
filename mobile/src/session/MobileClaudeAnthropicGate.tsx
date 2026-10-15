import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'
import { CLAUDE_SIGNED_OUT_LINE, CLAUDE_UNMATCHED_LINE, type ClaudeChatGate } from './use-claude-anthropic-transcript'

/**
 * A Claude tab's chat when it cannot read the session from Anthropic: signed out, or no Remote
 * Control session found for the tab. One line saying why, the reason the match gave in muted
 * words under it, and the one action that fixes it. Never Orca's transcript in its place.
 */
export function MobileClaudeAnthropicGate({
  gate,
  onSignIn,
  onOpenTerminal
}: {
  gate: Extract<ClaudeChatGate, { kind: 'signed-out' | 'unmatched' }>
  /** Opens the Anthropic accounts screen (open-anthropic-accounts.ts). */
  onSignIn: () => void
  onOpenTerminal?: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const signedOut = gate.kind === 'signed-out'
  return (
    <View style={styles.root} testID="claude-anthropic-gate">
      <Text style={styles.line} accessibilityRole="text">
        {signedOut ? CLAUDE_SIGNED_OUT_LINE : CLAUDE_UNMATCHED_LINE}
      </Text>
      {gate.kind === 'unmatched' ? <Text style={styles.detail}>{gate.detail}</Text> : null}
      <View style={styles.actions}>
        <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel={signedOut ? 'Sign in' : 'Accounts'} style={styles.primary}>
          <Text style={styles.primaryText}>{signedOut ? 'Sign in' : 'Accounts'}</Text>
        </Pressable>
        {onOpenTerminal ? (
          <Pressable onPress={onOpenTerminal} accessibilityRole="button" accessibilityLabel="Open terminal" style={styles.secondary}>
            <Text style={styles.secondaryText}>Open terminal</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function makeStyles({ colors, space, radius }: Theme) {
  return StyleSheet.create({
    root: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.chatBg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xl,
      gap: space.sm
    },
    line: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: 'center' },
    detail: { color: colors.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
    primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
    secondaryText: { color: colors.text, fontSize: 15 }
  })
}
