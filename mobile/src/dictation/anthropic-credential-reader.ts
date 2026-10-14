import {
  readCredential as readPhoneCredential,
  refreshAccessToken
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
  const phoneCred = await readPhoneCredential()
  if (!phoneCred?.accessToken) {
    return null
  }
  if (phoneCred.expiresAt - Date.now() >= TOKEN_MARGIN_MS) {
    return phoneCred
  }
  try {
    return await refreshAccessToken(phoneCred)
  } catch {
    return phoneCred.expiresAt > Date.now() ? phoneCred : null
  }
}
