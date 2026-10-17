import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { ClawdDancing } from './ClawdDancing'

/** The viewer's own sign-in state, drawn instead of claude.ai's "Sign in to view this page", which
 *  had no way forward in the app (reported 2026-10-17). */
export const ARTIFACT_VIEWER_SIGN_IN_BROWSER_NOTE = "Signing in from Open in browser doesn't sign the app in."
export const ARTIFACT_VIEWER_NO_ACCOUNT = 'Sign in to Anthropic in Anthropic accounts to open artifacts.'
export const ARTIFACT_VIEWER_PICK_ACCOUNT = 'Which account is this artifact from?'
export const ARTIFACT_VIEWER_OPEN_ACCOUNTS = 'Open Anthropic accounts'

/** What the viewer says when the account it would open the artifact as has no claude.ai session:
 *  that account was signed in before one sign-in gave it artifacts too (or in the browser). */
export function artifactViewerSignInAgain(label: string | null): string {
  return label
    ? `Sign in to ${label} again in Anthropic accounts to open artifacts.`
    : 'Sign in to this account again in Anthropic accounts to open artifacts.'
}

/**
 * What stands in for the page before it may load (use-artifact-viewer-session.ts).
 *  - `checking`: the account's claude.ai session is being written into the jar; the Clawd cover.
 *  - `needed`: no session for the artifact's account. `accountId` set: it says to sign in to that
 *    account again and opens Anthropic accounts (`onOpenAccounts`), where the one sign-in is.
 *    Unset with `choices`: the user picks the account (`onPick`). No choices: nobody is signed in
 *    to Code UI, and the same button opens Anthropic accounts.
 */
export type ArtifactViewerSignIn =
  | { kind: 'checking' }
  | {
      kind: 'needed'
      accountId: string | null
      label: string | null
      choices: readonly { id: string; label: string }[]
      onOpenAccounts: () => void
      onPick: (accountId: string) => void
    }

/**
 * The viewer's sign-in state (MobileArtifactViewer.tsx), drawn in place of the page: the Clawd
 * cover while the account's session is written, or, when the account it would open the artifact
 * as has no claude.ai session, what to do about it. It points at Anthropic accounts,
 * where the one sign-in is (AnthropicSignInScreen.tsx); the browser is a quiet second choice,
 * since a browser sign-in cannot reach this WebView.
 */
export function ArtifactViewerSignInState({
  signIn,
  still,
  onOpenBrowser
}: {
  signIn: ArtifactViewerSignIn
  /** Reduced motion: Clawd stands still. */
  still: boolean
  onOpenBrowser: () => void
}) {
  const { colors, space } = useTheme()
  if (signIn.kind === 'checking') {
    // The same Clawd cover the page loads under (READY_SCRIPT), in the column below the bar.
    return (
      <View testID="artifact-viewer-loading" pointerEvents="none" style={[styles.centred, { backgroundColor: colors.bg }]}>
        <ClawdDancing still={still} testID="artifact-viewer-loading-clawd" />
      </View>
    )
  }
  return (
    <View testID="artifact-viewer-sign-in" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: space.md }}>
      <Txt testID="artifact-viewer-sign-in-title" variant="heading" weight="semibold" align="center">
        {signIn.accountId === null && signIn.choices.length === 0
          ? ARTIFACT_VIEWER_NO_ACCOUNT
          : signIn.accountId === null
            ? ARTIFACT_VIEWER_PICK_ACCOUNT
            : artifactViewerSignInAgain(signIn.label)}
      </Txt>
      {signIn.accountId === null && signIn.choices.length > 0 ? (
        <View style={{ alignSelf: 'stretch', gap: space.sm }}>
          {signIn.choices.map((choice) => (
            <Pressable
              key={choice.id}
              testID={`artifact-viewer-sign-in-pick-${choice.id}`}
              accessibilityRole="button"
              onPress={() => signIn.onPick(choice.id)}
              style={[styles.textButton, { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong }]}
            >
              <Txt variant="label" weight="semibold">
                {choice.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          testID="artifact-viewer-sign-in-button"
          accessibilityRole="button"
          onPress={signIn.onOpenAccounts}
          style={[styles.textButton, { backgroundColor: colors.text }]}
        >
          <Txt variant="label" weight="semibold" style={{ color: colors.bg }}>
            {ARTIFACT_VIEWER_OPEN_ACCOUNTS}
          </Txt>
        </Pressable>
      )}
      <Txt variant="caption" tone="muted" align="center">
        {ARTIFACT_VIEWER_SIGN_IN_BROWSER_NOTE}
      </Txt>
      <Pressable testID="artifact-viewer-sign-in-open-browser" accessibilityRole="button" onPress={onOpenBrowser} style={styles.textButton}>
        <Txt variant="label" tone="secondary">
          Open in browser instead
        </Txt>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }
})
