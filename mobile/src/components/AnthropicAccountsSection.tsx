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

/** What the row under "Add another account" says. The sign-in runs in the app
 *  (AnthropicSignInScreen), starting at claude.ai's login with no account picked, and one sign-in
 *  also opens the account's artifacts. */
export const ADD_ACCOUNT_HINT = 'Sign in with the other account. Artifacts open with it too.'
/** The first sign-in's row. */
export const FIRST_SIGN_IN_HINT = 'Used for sessions, usage, dictation and artifacts.'
/** The first usable account's row when several are listed: a chat dictates with its own account,
 *  and this one answers outside a chat or for a chat whose account is not known. */
export const DICTATION_FALLBACK_ROW = "Signed in. Dictation uses the chat's own account, else this one."
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
  // Dictation in a chat uses that chat's own account; outside a chat, or in one whose account is not
  // known, the first account still signed in (readPrimaryAccount), and that row says so. With
  // several accounts listed it says the chat's account comes first (review of 2026-10-17). One whose
  // sign-in died says so instead of "Signed in", as the single-account screen did (isLoggedIn)
  // before 2026-10-14.
  const now = readAt
  const voiceAccountId = accounts?.find((account) => isAccountUsable(account, now))?.id ?? null

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
                <Text style={styles.rowSublabel}>
                  {!isAccountUsable(account, now)
                    ? 'Signed out. Sign in to this account again.'
                    : account.id === voiceAccountId
                      ? accounts.length > 1
                        ? DICTATION_FALLBACK_ROW
                        : 'Signed in. Dictation uses this account.'
                      : 'Signed in.'}
                </Text>
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
              <Text style={styles.rowSublabel}>{signedIn ? ADD_ACCOUNT_HINT : FIRST_SIGN_IN_HINT}</Text>
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
