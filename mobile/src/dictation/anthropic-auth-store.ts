import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import * as Linking from 'expo-linking'

const STORE_KEY = 'anthropic-dictation-oauth'
const VERIFIER_KEY = 'anthropic-dictation-pkce-verifier'

// Production OAuth endpoints (from Claude Code 2.1.296).
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const SCOPES = [
  'user:inference',
  'user:profile',
  'user:sessions:claude_code'
]

export type StoredCredential = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

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
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: SCOPES.join(' ')
  })
  const url = `${AUTHORIZE_URL}?${params}`
  await SecureStore.setItemAsync(VERIFIER_KEY, codeVerifier)
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
  code: string,
  codeVerifier: string
): Promise<StoredCredential> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: code.trim(),
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Token exchange failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`
    )
  }
  const credential = parseTokenResponse(await res.json())
  await storeCredential(credential)
  await SecureStore.deleteItemAsync(VERIFIER_KEY).catch(() => undefined)
  return credential
}

/**
 * Refresh the access token. Validates the response shape before storing.
 */
export async function refreshAccessToken(
  credential: StoredCredential
): Promise<StoredCredential> {
  if (!credential.refreshToken) {
    throw new Error('No refresh token')
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: credential.refreshToken
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`)
  }
  const raw = parseTokenResponse(await res.json())
  const refreshed: StoredCredential = {
    ...raw,
    refreshToken: raw.refreshToken || credential.refreshToken
  }
  await storeCredential(refreshed)
  return refreshed
}

// ---------------------------------------------------------------------------
// Secure storage
// ---------------------------------------------------------------------------

export async function storeCredential(
  credential: StoredCredential
): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(credential))
}

export async function readCredential(): Promise<StoredCredential | null> {
  const raw = await SecureStore.getItemAsync(STORE_KEY)
  if (!raw) {
    return null
  }
  try {
    const data = JSON.parse(raw)
    if (typeof data.accessToken !== 'string' || !data.accessToken) {
      return null
    }
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? '',
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0
    }
  } catch {
    return null
  }
}

export async function clearCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(VERIFIER_KEY).catch(() => undefined)
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
