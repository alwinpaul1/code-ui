import { fetchAccountCredentials, fetchAnthropicCredential } from './anthropic-credential-reader'
import { SIGN_IN_TO_DICTATE, type DictationAccountLookup } from './dictation-account-lookup'

/** Which Anthropic account a take dictates with, and its token (use-anthropic-dictation.ts). */

/**
 * The chat a take dictates into: its Anthropic account's id when proven, or null with `resolve`,
 * which finds it exactly before the take's stream opens (session/dictation-session-account.ts; the
 * session screen always hands that, dictation-chat-account.ts). Left out outside a Claude chat.
 */
export type DictationChatAccount = {
  readonly accountId: string | null
  readonly resolve?: () => Promise<DictationAccountLookup>
}

/** What a take dictates with: a token and its account's organization, or why there is none. */
export type DictationCredential =
  | { readonly ok: true; readonly accessToken: string; readonly organizationUuid: string | null }
  | { readonly ok: false; readonly reason: string }

/** A Claude session whose account is not known and cannot be looked up. */
export const UNKNOWN_SESSION_ACCOUNT =
  "Can't tell which Anthropic account this session belongs to, so dictation won't use another one. Sign in to that account in Settings, Anthropic accounts, to dictate here."

/** The session's account, found on demand when it was not matched before the tap. */
async function lookUpChatAccount(resolve: () => Promise<DictationAccountLookup>): Promise<DictationAccountLookup> {
  const looked = await resolve().catch(
    (err: unknown): DictationAccountLookup => ({
      ok: false,
      reason: `Can't tell which Anthropic account this session belongs to: ${err instanceof Error ? err.message : String(err)}`
    })
  )
  if (!looked.ok) {
    console.warn(`[dictation] refused: this session's Anthropic account could not be found exactly: ${looked.reason}`)
  }
  return looked
}

/**
 * The credential for one take. In a chat with a known account, that account's token and
 * organization and nothing else: if it cannot give a token the take is refused with the reason,
 * because dictating with another account would send voice_stream the wrong organization (review of
 * 2026-10-17: every take used the first account signed in, whatever chat it went into). A chat
 * whose account is not matched yet is looked up first (`resolve`), and dictates with what that
 * finds or is refused with its reason and one log line; with no lookup it is refused
 * (UNKNOWN_SESSION_ACCOUNT). Only outside a Claude session, where no account is its own, is the
 * first account signed in used. Null: the take was cancelled while the lookup ran.
 */
export async function readDictationCredential(
  chat: DictationChatAccount | undefined,
  stillWanted: () => boolean
): Promise<DictationCredential | null> {
  let accountId = chat?.accountId ?? null
  if (chat && accountId === null) {
    // Exactly the session's own account, or none (user, 2026-10-17: "use the account or profile
    // that sessions exactly belongs to", "it must exactly tell"); until 0.9.159 this fell back to
    // the first account.
    if (!chat.resolve) {
      console.warn(
        "[dictation] this session's Anthropic account is not known (several are signed in and none is matched to it); dictating with nobody else's account"
      )
      return { ok: false, reason: UNKNOWN_SESSION_ACCOUNT }
    }
    const looked = await lookUpChatAccount(chat.resolve)
    if (!stillWanted()) {
      return null
    }
    if (!looked.ok) {
      return { ok: false, reason: looked.reason }
    }
    accountId = looked.accountId
  }
  if (accountId === null) {
    // Not a Claude session (a terminal, a Codex chat): no Anthropic account is its own.
    const primary = await fetchAnthropicCredential().catch(() => null)
    if (!primary) {
      return { ok: false, reason: SIGN_IN_TO_DICTATE }
    }
    return { ok: true, accessToken: primary.accessToken, organizationUuid: primary.organizationUuid ?? null }
  }
  let listed
  try {
    listed = await fetchAccountCredentials(accountId)
  } catch (err) {
    return { ok: false, reason: `Can't read this chat's Anthropic account to dictate: ${err instanceof Error ? err.message : String(err)}` }
  }
  const account = listed[0]
  if (!account) {
    return {
      ok: false,
      reason: "This chat's Anthropic account is no longer signed in on the phone. Sign in to it again in Settings, Anthropic accounts, to dictate here"
    }
  }
  if (!account.accessToken) {
    return { ok: false, reason: `Can't dictate with ${account.label}, this chat's account: ${account.error ?? 'it has no sign-in token'}` }
  }
  return { ok: true, accessToken: account.accessToken, organizationUuid: account.organizationUuid }
}
