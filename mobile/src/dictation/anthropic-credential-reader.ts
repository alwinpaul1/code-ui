import {
  accountLabel,
  listAccounts,
  readPrimaryAccount,
  refreshAccessToken,
  type StoredAccount,
  type StoredCredential
} from './anthropic-auth-store'

export type AnthropicCredential = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/** Token must have at least this much life left. */
const TOKEN_MARGIN_MS = 60_000

/**
 * The phone's own Anthropic sign-in, refreshed when it is near expiry; null when nobody is signed
 * in on the phone. Signing in on the phone is mandatory (the user, 2026-10-14): there is no
 * desktop fallback. A reader that opened a hidden terminal on the desktop to take Claude Code's
 * token out of its Keychain lived here until then, which CLAUDE.md forbids (nothing may open a
 * terminal on the user's machine to read files), and the voice server rejected that token anyway.
 *
 * On refresh failure the original token is kept if it has any life left: a dictation is
 * typically under 30 s.
 */
export async function fetchAnthropicCredential(): Promise<AnthropicCredential | null> {
  const primary = await readPrimaryAccount()
  return primary ? liveCredential(primary) : null
}

/** The account's token, refreshed when near expiry, or whenever `force` (a server refused it with
 *  401 though it had life left). A refresh token the server already refused is not spent again:
 *  the account keeps what life its access token has, then reads as signed out. */
async function liveCredential(account: StoredAccount, force = false): Promise<StoredCredential | null> {
  const phoneCred = account.credential
  if (!phoneCred.accessToken) {
    return null
  }
  if (!force && phoneCred.expiresAt - Date.now() >= TOKEN_MARGIN_MS) {
    return phoneCred
  }
  if (account.refreshRefused) {
    return phoneCred.expiresAt > Date.now() ? phoneCred : null
  }
  try {
    return await refreshAccessToken(phoneCred)
  } catch {
    return phoneCred.expiresAt > Date.now() ? phoneCred : null
  }
}

/** One signed-in account as the sessions path reads it: a live token, or the reason there is none. */
export type AccountCredential = {
  readonly id: string
  readonly label: string
  readonly accessToken: string | null
  readonly organizationUuid: string | null
  /** Why `accessToken` is null: the refresh was refused or could not be made. */
  readonly error?: string
}

/**
 * Every signed-in account with its token refreshed when near expiry, each on its own: one
 * account's refresh failing leaves it without a token and the others untouched. The sessions path
 * (session/ccr-session-default-deps.ts) reads this; dictation reads only the first account, through
 * fetchAnthropicCredential. An empty list means nobody is signed in. With `only`, just that
 * account is read and refreshed (the model pill re-reads one matched account, not every one).
 * With `refresh`, each token is refreshed whatever life it has left: a server refused it (401).
 */
export async function fetchAccountCredentials(only?: string, options: { refresh?: boolean } = {}): Promise<AccountCredential[]> {
  const accounts = await listAccounts()
  return Promise.all(
    accounts.flatMap((account, index) => (only === undefined || account.id === only ? [{ account, index }] : [])).map(async ({ account, index }): Promise<AccountCredential> => {
      const label = accountLabel(account, index)
      const base = { id: account.id, label, organizationUuid: account.organizationUuid }
      const live = await liveCredential(account, options.refresh === true)
      return live
        ? { ...base, accessToken: live.accessToken }
        : { ...base, accessToken: null, error: 'the sign-in expired and could not be refreshed; sign in to this account again in Settings, Anthropic accounts' }
    })
  )
}
