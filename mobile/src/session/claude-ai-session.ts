import { requireOptionalNativeModule } from 'expo-modules-core'
import { subscribeAnthropicAccountsChanged, type AnthropicAccountsChange } from '../dictation/anthropic-accounts-events'

// ─── Each Code UI account's claude.ai web session ────────────────────────────
//
// Code UI's account sign-in is Claude Code's OAuth: a bearer for api.anthropic.com. claude.ai's
// pages, the artifact viewer's among them, authenticate with the `sessionKey` + `lastActiveOrg`
// cookies, and nothing trades one for the other. So the in-app sign-in (AnthropicSignInScreen.tsx)
// runs the OAuth authorize page inside a WebView: claude.ai's own login there leaves the account's
// session in the WebView's cookie jar, and modules/orca-claude-session takes it from the jar and
// keeps it, encrypted, per account. Before the viewer loads an artifact it writes the owning
// account's session back into the jar (seedClaudeSession), as the Claude Android app 1.261013.20
// does (a22.java).
//
// The session key itself never reaches JavaScript: the native side answers with the organization
// uuid and booleans only, and this file's types have nowhere to put a key. Where the module is
// absent (web, iOS, a test that does not stand one in), every call answers "unavailable" and the
// viewer falls back to claude.ai's own page.

export const CLAUDE_SESSION_MODULE = 'OrcaClaudeSession'

/** What the native module answers. Nothing here carries the session key. */
export type NativeClaudeSession = {
  peekClaudeSession(): Promise<{ signedIn: boolean; org: string | null }>
  captureClaudeSession(accountId: string, expectedOrg: string): Promise<{ org: string | null; stored: boolean }>
  seedClaudeSession(accountId: string): Promise<boolean>
  hasClaudeSession(accountId: string): Promise<boolean>
  clearClaudeSession(accountId: string): Promise<void>
  clearAllClaudeSessions(): Promise<void>
  clearClaudeCookies(): Promise<void>
  lastClaudeSessionAccount(): Promise<string | null>
}

function native(): NativeClaudeSession | null {
  return requireOptionalNativeModule<NativeClaudeSession>(CLAUDE_SESSION_MODULE)
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const listeners = new Set<() => void>()

/** Hears that some account's stored claude.ai session was stored or forgotten. */
export function subscribeClaudeSessionChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function changed(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(`[claude-session] a listener failed: ${reasonOf(error)}`)
    }
  }
}

/** Whether the phone can keep claude.ai sessions at all (the Android module is there). */
export function claudeSessionAvailable(): boolean {
  return native() !== null
}

/** Whether the account has a claude.ai session stored. False where the module is absent or fails. */
export async function hasClaudeSession(accountId: string): Promise<boolean> {
  const module = native()
  if (module === null) {
    return false
  }
  try {
    return await module.hasClaudeSession(accountId)
  } catch (error) {
    console.warn(`[claude-session] could not tell whether an account has a claude.ai session: ${reasonOf(error)}`)
    return false
  }
}

/**
 * Puts the account's claude.ai session in the WebView's cookie jar, replacing whatever session was
 * there. `seeded`: the viewer can load the artifact signed in as this account. `none`: nothing is
 * stored for it (and the jar's session was cleared, so another account's cannot answer for it).
 * `unavailable`: no module, or it failed; the viewer loads claude.ai's page as it is.
 */
export async function seedClaudeSession(accountId: string): Promise<'seeded' | 'none' | 'unavailable'> {
  const module = native()
  if (module === null) {
    return 'unavailable'
  }
  try {
    return (await module.seedClaudeSession(accountId)) ? 'seeded' : 'none'
  } catch (error) {
    console.warn(`[claude-session] could not put the account's claude.ai session in the WebView: ${reasonOf(error)}`)
    return 'unavailable'
  }
}

/** The account the viewer last opened an artifact as, or null. */
export async function lastClaudeSessionAccount(): Promise<string | null> {
  const module = native()
  if (module === null) {
    return null
  }
  try {
    return await module.lastClaudeSessionAccount()
  } catch (error) {
    console.warn(`[claude-session] could not read the last account: ${reasonOf(error)}`)
    return null
  }
}

/** Clears every claude.ai cookie from the WebView's jar, so a sign-in starts at claude.ai's login
 *  instead of reusing whichever account the jar was on. */
export async function clearClaudeCookies(): Promise<void> {
  try {
    await native()?.clearClaudeCookies()
  } catch (error) {
    console.warn(`[claude-session] could not clear the claude.ai cookies: ${reasonOf(error)}`)
  }
}

/** One Code UI account as the capture matches it. */
export type ClaudeSessionAccount = { id: string; organizationUuid: string | null; label: string }

/**
 * What a claude.ai sign-in came to.
 *  - `stored`: the session belongs to the account and is kept.
 *  - `waiting`: the jar has no single signed-in session with an organization yet (the login is not
 *    finished, or claude.ai has not set lastActiveOrg); ask again after the next page.
 *  - `other-account`: the session belongs to another organization. Nothing was stored and the jar
 *    was cleared. `label` names the Code UI account it belongs to when one does, else null.
 *  - `unknown-org`: the Code UI account's own organization is not known, so the session cannot be
 *    matched to it; nothing stored.
 *  - `failed`: the module is absent, threw, or could not store.
 */
export type ClaudeSessionCapture =
  | { kind: 'stored' }
  | { kind: 'waiting' }
  | { kind: 'other-account'; label: string | null }
  | { kind: 'unknown-org' }
  | { kind: 'failed'; reason: string }

/**
 * Takes the claude.ai session the WebView's jar holds for `account`, if it is that account's: the
 * jar's lastActiveOrg must be the account's organizationUuid. On any other organization nothing is
 * stored and the jar's claude.ai cookies are cleared, so artifacts never open as the wrong account.
 * `others` names the other Code UI accounts, so the message can say whose session it was.
 */
export async function captureClaudeSession(
  account: ClaudeSessionAccount,
  others: readonly ClaudeSessionAccount[] = []
): Promise<ClaudeSessionCapture> {
  const module = native()
  if (module === null) {
    return { kind: 'failed', reason: 'this phone cannot keep a claude.ai sign-in' }
  }
  try {
    const jar = await module.peekClaudeSession()
    if (!jar.signedIn || !jar.org) {
      return { kind: 'waiting' }
    }
    if (!account.organizationUuid) {
      return { kind: 'unknown-org' }
    }
    if (jar.org !== account.organizationUuid) {
      await module.clearClaudeCookies()
      const owner = others.find((other) => other.id !== account.id && other.organizationUuid === jar.org)
      return { kind: 'other-account', label: owner?.label ?? null }
    }
    // The native side checks the organization again, where the session key is.
    const result = await module.captureClaudeSession(account.id, account.organizationUuid)
    if (!result.stored) {
      return result.org !== null && result.org !== account.organizationUuid
        ? { kind: 'other-account', label: others.find((other) => other.organizationUuid === result.org)?.label ?? null }
        : { kind: 'failed', reason: 'the claude.ai sign-in could not be stored' }
    }
    changed()
    return { kind: 'stored' }
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) }
  }
}

/** What the user is told for a claude.ai sign-in that was another account's. */
export function claudeSessionOtherAccountMessage(label: string | null): string {
  const whose = label ? `as ${label}, a different account` : 'as a different account'
  return `You signed in to claude.ai ${whose}; switch accounts there and try again.`
}

/** Forgets one account's claude.ai session (and clears the jar if it holds that session). */
export async function forgetClaudeSession(accountId: string): Promise<void> {
  const module = native()
  if (module === null) {
    return
  }
  try {
    await module.clearClaudeSession(accountId)
    changed()
  } catch (error) {
    console.warn(`[claude-session] could not forget an account's claude.ai session: ${reasonOf(error)}`)
  }
}

/** Forgets every account's claude.ai session and clears the jar. */
export async function forgetAllClaudeSessions(): Promise<void> {
  const module = native()
  if (module === null) {
    return
  }
  try {
    await module.clearAllClaudeSessions()
    changed()
  } catch (error) {
    console.warn(`[claude-session] could not forget the claude.ai sessions: ${reasonOf(error)}`)
  }
}

/**
 * A signed-out account's claude.ai session goes with it: signing out of Code UI must not leave a
 * way to open that account's artifacts. Entries merged away or replaced (`removed`) are as dead.
 */
export function forgetClaudeSessionsOnSignOut(change: AnthropicAccountsChange): void {
  if (change.signedOut === 'all') {
    void forgetAllClaudeSessions()
    return
  }
  if (change.signedOut) {
    void forgetClaudeSession(change.signedOut)
  }
  for (const id of change.removed ?? []) {
    void forgetClaudeSession(id)
  }
}

let wired = false
/** Installs the sign-out listener once. Called at import by the screens that sign in or out. */
export function wireClaudeSessionSignOut(): void {
  if (!wired) {
    wired = true
    subscribeAnthropicAccountsChanged(forgetClaudeSessionsOnSignOut)
  }
}
