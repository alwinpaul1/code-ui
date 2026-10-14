import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import * as Linking from 'expo-linking'
import { fetchCcrProfile, type CcrProfile } from '../session/ccr-session-api'
import { clearAccounts, markRefreshRefused, readCredential, replaceCredentialOf, upsertAccount, type StoredCredential } from './anthropic-accounts-store'

export {
  accountLabel,
  forgetAccountOrganization,
  isAccountUsable,
  listAccounts,
  readCredential,
  readPrimaryAccount,
  rememberAccountProfile,
  removeAccount,
  type StoredAccount,
  type StoredCredential
} from './anthropic-accounts-store'

const VERIFIER_KEY = 'anthropic-dictation-pkce-verifier'
const STATE_KEY = 'anthropic-dictation-oauth-state'
// Production OAuth endpoints (from Claude Code 2.1.296).
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
/** Claude Code 2.1.296's claude.ai scopes: it refreshes with these (its lpt()) and logs in with
 *  org:create_api_key in front (its DTo()). 0.9.139 asked for three of them, and the voice server
 *  refused that token (2026-10-14). */
const REFRESH_SCOPES = [
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload'
]
const LOGIN_SCOPES = ['org:create_api_key', ...REFRESH_SCOPES]

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/** Characters allowed in an RFC 7636 code verifier. */
const VERIFIER_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/**
 * Generate a PKCE code verifier. Uses rejection sampling to avoid the
 * modulo bias the review flagged (256 % 66 ≠ 0).
 */
function generateCodeVerifier(): string {
  const len = 64
  // 66 chars in the alphabet. The largest multiple of 66 that fits in a
  // byte is 66 × 3 = 198. Reject bytes ≥ 198 for uniform distribution.
  const limit = 198
  let out = ''
  while (out.length < len) {
    const bytes = Crypto.getRandomBytes(len * 2)
    for (const b of bytes) {
      if (b < limit && out.length < len) {
        out += VERIFIER_CHARS[b % VERIFIER_CHARS.length]
      }
    }
  }
  return out
}

const BASE64URL_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 32 random bytes as base64url (43 characters, no padding), the shape Claude Code's state has. */
function generateState(): string {
  const bytes = Crypto.getRandomBytes(32)
  let out = ''
  let bits = 0
  let acc = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out += BASE64URL_CHARS[(acc >> bits) & 63]
    }
  }
  if (bits > 0) {
    out += BASE64URL_CHARS[(acc << (6 - bits)) & 63]
  }
  return out
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  )
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Token response validation (review fix #7)
// ---------------------------------------------------------------------------

function parseTokenResponse(data: unknown): StoredCredential {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Token response is not an object')
  }
  const obj = data as Record<string, unknown>
  const accessToken = obj.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Token response missing access_token')
  }
  const refreshToken =
    typeof obj.refresh_token === 'string' ? obj.refresh_token : ''
  const expiresIn =
    typeof obj.expires_in === 'number' ? obj.expires_in : 3600
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000
  }
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

/**
 * Open the Anthropic OAuth page in the phone's browser. The user signs in,
 * authorises Code UI, and sees a code on screen. They copy that code and
 * paste it back into the app.
 */
export async function startLogin(): Promise<string> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  // Same parameters, in the same order, as Claude Code 2.1.296's manual login. Without `state`
  // claude.ai answers "Invalid OAuth request: Missing state parameter" (2026-10-14), and `code=true`
  // asks for the page that shows the code to paste back.
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: LOGIN_SCOPES.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  })
  const url = `${AUTHORIZE_URL}?${params}`
  await SecureStore.setItemAsync(VERIFIER_KEY, codeVerifier)
  await SecureStore.setItemAsync(STATE_KEY, state)
  await Linking.openURL(url)
  return codeVerifier
}

/** Read back the verifier saved by `startLogin`. */
export async function getSavedVerifier(): Promise<string | null> {
  return SecureStore.getItemAsync(VERIFIER_KEY)
}

/**
 * Exchange the authorisation code the user pasted for an access + refresh
 * token pair. Validates the response shape before storing.
 */
export async function exchangeCode(
  pasted: string,
  codeVerifier: string
): Promise<StoredCredential> {
  // The callback page shows `<code>#<state>`; Claude Code splits it the same way.
  const [code, state] = pasted.trim().split('#')
  if (!code || !state) {
    throw new Error('Invalid code. Make sure the full code was copied')
  }
  if (state !== (await SecureStore.getItemAsync(STATE_KEY))) {
    throw new Error('This code is from a different sign-in. Tap Sign in again.')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
      state
    })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Token exchange failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`
    )
  }
  const credential = parseTokenResponse(await res.json())
  // Which account this is decides whether it replaces one already signed in. The profile is best
  // effort: dictation only needs the token, so a profile that cannot be read leaves the account
  // unidentified until the sessions path asks again (rememberAccountProfile).
  const profile = await readProfileWithin(credential.accessToken, PROFILE_TIMEOUT_MS).catch((error: unknown) => {
    console.warn(`[anthropic-auth] signed in, but the profile could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })
  await upsertAccount(credential, profile)
  await SecureStore.deleteItemAsync(VERIFIER_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(STATE_KEY).catch(() => undefined)
  return credential
}

/** How long a sign-in waits for its profile before storing the account unidentified. A request
 *  that never answers otherwise kept the code field's spinner busy forever. */
const PROFILE_TIMEOUT_MS = 15_000

/** The profile, or a rejection once `ms` pass (the request is aborted too). */
function readProfileWithin(token: string, ms: number): Promise<CcrProfile> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`the profile request timed out after ${ms / 1000} s`))
    }, ms)
  })
  const read = fetchCcrProfile((url, init) => fetch(url, { ...init, signal: controller.signal }), token)
  return Promise.race([read, timedOut]).finally(() => clearTimeout(timer))
}

/** Refreshes in flight, by refresh token. Dictation and the sessions path can both find one
 *  account due at the same moment; spending its refresh token twice could have the server treat
 *  the second use of a rotated token as a replay and refuse it. */
const refreshesInFlight = new Map<string, Promise<StoredCredential>>()

/**
 * Refresh the access token. Validates the response shape before storing. One refresh per refresh
 * token at a time: a second caller shares the first one's answer. A refusal from the token
 * endpoint (400/401/403) marks the account, so it reads as signed out once its token runs out.
 */
export function refreshAccessToken(credential: StoredCredential): Promise<StoredCredential> {
  if (!credential.refreshToken) {
    return Promise.reject(new Error('No refresh token'))
  }
  const running = refreshesInFlight.get(credential.refreshToken)
  if (running) {
    return running
  }
  const run = refreshOnce(credential).finally(() => {
    refreshesInFlight.delete(credential.refreshToken)
  })
  refreshesInFlight.set(credential.refreshToken, run)
  return run
}

/** The OAuth `error` code of a refused token request, or null when the body is not OAuth's. */
async function oauthErrorOf(res: { json: () => Promise<unknown> }): Promise<string | null> {
  try {
    const body: unknown = await res.json()
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    return typeof error === 'string' ? error : null
  } catch {
    return null
  }
}

async function refreshOnce(credential: StoredCredential): Promise<StoredCredential> {
  // JSON with the scopes, as Claude Code 2.1.296 refreshes.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: CLIENT_ID,
      scope: REFRESH_SCOPES.join(' ')
    })
  })
  if (!res.ok) {
    // Only OAuth's own answer for a spent or revoked refresh token, `invalid_grant` (RFC 6749
    // 5.2), marks the sign-in dead. A 403 from a WAF challenge or a captive portal is a refusal
    // of this request, not of the token, and the next refresh may well succeed.
    const reason = await oauthErrorOf(res)
    if (reason === 'invalid_grant') {
      await markRefreshRefused(credential).catch((error: unknown) => {
        console.warn(`[anthropic-auth] the refused sign-in could not be marked: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    throw new Error(`Token refresh failed (${res.status}${reason ? `: ${reason}` : ''})`)
  }
  const raw = parseTokenResponse(await res.json())
  const refreshed: StoredCredential = {
    ...raw,
    refreshToken: raw.refreshToken || credential.refreshToken
  }
  await replaceCredentialOf(credential, refreshed)
  return refreshed
}

// ---------------------------------------------------------------------------
// Secure storage
// ---------------------------------------------------------------------------

/** Signs every account out. */
export async function clearCredential(): Promise<void> {
  await clearAccounts()
  await SecureStore.deleteItemAsync(VERIFIER_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(STATE_KEY).catch(() => undefined)
}

/**
 * Review fix #9: check expiry, not just token presence. A fully expired
 * token with no refresh capability is not "logged in".
 */
export async function isLoggedIn(): Promise<boolean> {
  const cred = await readCredential()
  if (!cred || !cred.accessToken) {
    return false
  }
  // Valid if the token has life left, or if a refresh token can extend it.
  return cred.expiresAt > Date.now() || cred.refreshToken.length > 0
}
