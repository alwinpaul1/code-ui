/** The parts of a stored account that decide whether it can still get a token. No keystore in
 *  here, so the Anthropic accounts list can ask without loading the secure store. */
export type AccountSignInState = {
  readonly credential: { readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: number }
  /** The token endpoint refused this account's refresh token (HTTP 400/401/403). */
  readonly refreshRefused: boolean
}

/**
 * Whether an account is still signed in: its access token has life left, or it holds a refresh
 * token the server has not refused. An account that fails this is signed out in all but name: the
 * list says so, dictation does not use it, and a sign-in can take its place (upsertAccount). The
 * single-account builds drew the same line (isLoggedIn, "an expired token with no refresh
 * capability is not logged in").
 */
export function isAccountUsable(account: AccountSignInState, now: number = Date.now()): boolean {
  const { credential } = account
  if (!credential.accessToken) {
    return false
  }
  return credential.expiresAt > now || (credential.refreshToken.length > 0 && !account.refreshRefused)
}
