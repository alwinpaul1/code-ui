import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { radii, spacing } from '../theme/mobile-theme'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { Button } from '../ui/Button'
import {
  accountLabel,
  clearCredential,
  exchangeCode,
  getSavedVerifier,
  listAccounts,
  removeAccount,
  startLogin,
  type StoredAccount
} from '../dictation/anthropic-auth-store'
import { isAccountUsable } from '../dictation/anthropic-account-state'
import { voiceSettingsStyles } from './voice-settings-styles'

/** What the row under "Add another account" says. claude.ai signs in whichever account the phone's
 *  browser is on, so the other account has to be picked there before the code is asked for. */
export const ADD_ACCOUNT_HINT = 'Switch to the other account on claude.ai first.'

/**
 * The phone's Anthropic sign-ins: one row per Claude account (the default profile and a work
 * profile on the desktop are different accounts in different organizations, and the sessions API
 * only shows a session to its own organization), "Add another account", and "Sign out" per
 * account. The first account is the one voice dictation uses. Rendered on the Anthropic accounts
 * screen (Settings), whose ScrollView sets keyboardShouldPersistTaps for the code field.
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
   *  so the screen offers the one way out: clearing them. */
  const [unreadable, setUnreadable] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [showCodeInput, setShowCodeInput] = useState(false)

  const reload = useCallback(async () => {
    try {
      const listed = await listAccounts()
      setReadAt(Date.now())
      setAccounts(listed)
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

  const handleLogin = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await startLogin()
      setShowCodeInput(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the login page')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleSubmitCode = useCallback(async () => {
    if (!authCode.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const verifier = await getSavedVerifier()
      if (!verifier) {
        setError('No login in progress. Tap "Log in" first.')
        return
      }
      await exchangeCode(authCode.trim(), verifier)
      setAuthCode('')
      setShowCodeInput(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not exchange code')
    } finally {
      setBusy(false)
    }
  }, [authCode, reload])

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
      setError(`Could not clear the saved sign-ins: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [reload])

  const signedIn = accounts !== null && accounts.length > 0
  // Dictation uses the first account still signed in (readPrimaryAccount); one whose sign-in died says
  // so instead of "Signed in", as the single-account screen did (isLoggedIn) before 2026-10-14.
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
                      ? 'Signed in. Dictation uses this account.'
                      : 'Signed in.'}
                </Text>
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
        {accounts !== null && !showCodeInput ? (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => void handleLogin()}
            disabled={busy}
          >
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>{signedIn ? 'Add another account' : 'Sign in to Anthropic'}</Text>
              <Text style={styles.rowSublabel}>{signedIn ? ADD_ACCOUNT_HINT : 'Used for sessions, usage and dictation.'}</Text>
            </View>
            {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
          </Pressable>
        ) : null}
        {showCodeInput ? (
          <View style={styles.row}>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Text style={styles.rowSublabel}>Paste the code from the browser.</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TextInput
                  cursorColor={colors.caret}
                  style={{
                    flex: 1,
                    height: 40,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radii.button,
                    paddingHorizontal: spacing.sm,
                    fontFamily: 'monospace',
                    fontSize: 14,
                    color: colors.text,
                    backgroundColor: colors.bg
                  }}
                  placeholder="Auth code"
                  placeholderTextColor={colors.textMuted}
                  value={authCode}
                  onChangeText={setAuthCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  secureTextEntry
                  onSubmitEditing={() => void handleSubmitCode()}
                  returnKeyType="done"
                />
                <Button
                  label={busy ? '…' : 'Done'}
                  variant="primary"
                  align="center"
                  onPress={() => void handleSubmitCode()}
                  disabled={busy || !authCode.trim()}
                />
              </View>
            </View>
          </View>
        ) : null}
        {error ? (
          <View style={{ paddingHorizontal: spacing.md + 2, paddingBottom: spacing.sm }}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        {unreadable ? (
          <View style={{ paddingHorizontal: spacing.md + 2, paddingBottom: spacing.sm }}>
            <Button label="Clear saved sign-ins" variant="secondary" align="center" onPress={() => void handleClear()} disabled={busy} />
          </View>
        ) : null}
      </View>
    </>
  )
}
