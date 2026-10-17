/** Words and shapes the dictation hook shares with the session's account lookup
 *  (session/dictation-session-account.ts), kept here so neither pulls in the other's native code. */

export const SIGN_IN_TO_DICTATE = 'Sign in to Anthropic in Settings, Anthropic accounts, to dictate'

/** Which account a session belongs to, as found when a take starts, or exactly why it is not known. */
export type DictationAccountLookup = { readonly ok: true; readonly accountId: string } | { readonly ok: false; readonly reason: string }
