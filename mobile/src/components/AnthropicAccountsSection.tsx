import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { spacing } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { Button } from '../ui/Button'
import {
  accountLabel,
  clearCredential,
  listAccounts,
  removeAccount,
  type StoredAccount
} from '../dictation/anthropic-auth-store'
import { isAccountUsable } from '../dictation/anthropic-account-state'
import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import { claudeSessionAvailable, hasClaudeSession, subscribeClaudeSessionChanged, wireClaudeSessionSignOut } from '../session/claude-ai-session'
import { openAnthropicSignIn } from '../session/open-anthropic-sign-in'
import { voiceSettingsStyles } from './voice-settings-styles'

// Signing out of an account forgets its claude.ai session too (claude-ai-session.ts).
wireClaudeSessionSignOut()

/** An account signed in before the in-app sign-in existed has no claude.ai session, and nothing
 *  else gives it one: the row says so, and the way through is the
 *  ordinary sign-in again (Add another account), which updates the account in place. */
export const SIGN_IN_AGAIN_FOR_ARTIFACTS = 'To open its artifacts in the app, sign in to this account again with Add another account.'

/**
 * The phone's Anthropic sign-ins: one row per Claude account (the default profile and a work
 * profile on the desktop are different accounts in different organizations, and the sessions API
 * only shows a session to its own organization), "Add another account", and "Sign out" per
 * account. The first account is the one voice dictation uses. Rendered on the Anthropic accounts
 * screen (Settings).
 */
export function AnthropicAccountsSection(): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useThemedStyles(voiceSettingsStyles)
  const [accounts, setAccounts] = useState<StoredAccount[] | null>(null)
  /** When the list was read: whether each account is still signed in is judged at that moment. */
  const [readAt, setReadAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The saved sign-ins could not be read. The store refuses every write then, sign-in included,
   *  so the screen offers the one way out: Sign out, which deletes them unread. */
  const [unreadable, setUnreadable] = useState(false)
  /** Accounts with no claude.ai session stored: their row says to sign in again for artifacts. */
  const [unconnected, setUnconnected] = useState<ReadonlySet<string>>(new Set())

  const reload = useCallback(async () => {
    try {
      const listed = await listAccounts()
      const missing = claudeSessionAvailable()
        ? (await Promise.all(listed.map(async (account) => ((await hasClaudeSession(account.id)) ? null : account.id)))).filter(
            (id): id is string => id !== null
          )
        : []
      setReadAt(Date.now())
      setAccounts(listed)
      setUnconnected(new Set(missing))
      setUnreadable(false)
    } catch (err) {
      // An unreadable store reads as signed out, and says why instead of leaving a bare button.
      setAccounts([])
      setUnreadable(true)
      setError(`Could not read the saved sign-ins: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])
  // The in-app sign-in is its own screen: the list hears what it changed.
  useEffect(() => subscribeAnthropicAccountsChanged(() => void reload()), [reload])
  useEffect(() => subscribeClaudeSessionChanged(() => void reload()), [reload])

  const handleSignOut = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        await removeAccount(id)
        await reload()
      } catch (err) {
        setError(`Could not sign out: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [reload]
  )

  const handleClear = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await clearCredential()
      await reload()
    } catch (err) {
      setError(`Could not sign out: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [reload])

  const signedIn = accounts !== null && accounts.length > 0
  // A working account is its name and its Sign out button (user, 2026-10-17: "remove the subtext in
  // small"). The small line is kept only for one that needs something done: a sign-in that died
  // (isLoggedIn's wording before 2026-10-14) or one with no claude.ai session for its artifacts.
  const now = readAt

  return (
    <>
      <Text style={styles.groupHeading}>{signedIn && accounts.length > 1 ? 'ANTHROPIC ACCOUNTS' : 'ANTHROPIC ACCOUNT'}</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        {accounts === null ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : (
          accounts.map((account, index) => (
            <View key={account.id} style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>{accountLabel(account, index)}</Text>
                {!isAccountUsable(account, now) ? (
                  <Text style={styles.rowSublabel}>Signed out. Sign in to this account again.</Text>
                ) : null}
                {isAccountUsable(account, now) && unconnected.has(account.id) ? (
                  <Text style={styles.rowSublabel}>{SIGN_IN_AGAIN_FOR_ARTIFACTS}</Text>
                ) : null}
              </View>
              <Button
                label="Sign out"
                variant="secondary"
                align="center"
                onPress={() => void handleSignOut(account.id)}
                disabled={busy}
              />
            </View>
          ))
        )}
        {/* The one way in (user, 2026-10-17: one sign-in only). It runs in the app, so the same
            sign-in keeps the account's claude.ai session for artifacts (AnthropicSignInScreen). */}
        {accounts !== null ? (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => openAnthropicSignIn()}
            disabled={busy}
          >
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>{signedIn ? 'Add another account' : 'Sign in to Anthropic'}</Text>
            </View>
          </Pressable>
        ) : null}
        {error ? (
          <View style={{ paddingHorizontal: spacing.md + 2, paddingBottom: spacing.sm }}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        {unreadable || (accounts !== null && accounts.length > 1) ? (
          <View style={{ paddingHorizontal: spacing.md + 2, paddingBottom: spacing.sm }}>
            {/* Sign out is what clears. Unreadable sign-ins cannot be listed, so this one button
                deletes the stored keys without reading them; with 2+ accounts it signs all out. */}
            <Button
              label={unreadable ? 'Sign out' : 'Sign out of all accounts'}
              variant="secondary"
              align="center"
              onPress={() => void handleClear()}
              disabled={busy}
            />
          </View>
        ) : null}
      </View>
    </>
  )
}
