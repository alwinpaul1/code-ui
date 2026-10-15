import * as SecureStore from 'expo-secure-store'
import type { CcrProfile } from '../session/ccr-session-api'
import { isAccountUsable } from './anthropic-account-state'
import { notifyAnthropicAccountsChanged } from './anthropic-accounts-events'

export { isAccountUsable } from './anthropic-account-state'

/** v2 since 2026-10-14: tokens carry Claude Code's six login scopes. A sign-in stored under the
 *  old key holds the three-scope token the voice server refused, so it no longer counts and is
 *  deleted on the next read; the mic then asks for a new sign-in. */
const STORE_KEY = 'anthropic-dictation-oauth-v2'
/** Every signed-in account, in sign-in order (the first is the primary, which dictation uses).
 *  Since 2026-10-14 the phone signs in to each Claude account the user runs on the desktop: the
 *  default profile and a work profile are different accounts in different organizations, and the
 *  sessions API only shows a session to the organization that owns it. A sign-in stored under
 *  STORE_KEY by an earlier build is moved here on the first read (migrateLegacySignIn). */
const ACCOUNTS_KEY = 'anthropic-accounts-v1'
const PRE_SCOPES_STORE_KEY = 'anthropic-dictation-oauth'
/** The one organization cache of the single-account builds. Read once by the migration, then deleted:
 *  each account now carries its own organization. */
const ORG_STORE_KEY = 'anthropic-ccr-org-v1'


export type StoredCredential = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/** One signed-in Anthropic account. `id` is the account uuid once the profile is known; until then
 *  it is a `pending-…` placeholder, so an unidentified sign-in still has a stable handle. */
export type StoredAccount = {
  readonly id: string
  readonly credential: StoredCredential
  readonly accountUuid: string | null
  readonly organizationUuid: string | null
  /** `organization.name` from /api/oauth/profile, for the list on screen. */
  readonly organizationName: string | null
  /** When this credential was signed in (ms); 0 for one migrated from a build that did not keep
   *  it. A refresh keeps it: it orders sign-ins, so a merge keeps the newer one. */
  readonly signedInAt: number
  /** The token endpoint refused this account's refresh token: once its access token runs out the
   *  account is signed out (isAccountUsable). A sign-in again clears it. */
  readonly refreshRefused: boolean
}

/** Every read-modify-write of the accounts runs through this chain: two accounts refreshing at
 *  once must not overwrite each other's new token with the list they read before. */
let accountsLock: Promise<unknown> = Promise.resolve()

function withAccounts<T>(work: () => Promise<T>): Promise<T> {
  const run = accountsLock.then(work, work)
  accountsLock = run.catch(() => undefined)
  return run
}

function parseCredential(data: unknown): StoredCredential | null {
  const value = data as Partial<StoredCredential> | null
  if (!value || typeof value.accessToken !== 'string' || !value.accessToken) {
    return null
  }
  return {
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : '',
    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : 0
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function parseAccounts(raw: string | null): StoredAccount[] | null {
  if (!raw) {
    return null
  }
  try {
    const list = (JSON.parse(raw) as { accounts?: unknown }).accounts
    if (!Array.isArray(list)) {
      return null
    }
    const accounts: StoredAccount[] = []
    for (const item of list) {
      const entry = item as Partial<StoredAccount> | null
      const credential = parseCredential(entry?.credential)
      const id = textOrNull(entry?.id)
      if (credential && id) {
        accounts.push({
          id,
          credential,
          accountUuid: textOrNull(entry?.accountUuid),
          organizationUuid: textOrNull(entry?.organizationUuid),
          organizationName: textOrNull(entry?.organizationName),
          signedInAt: typeof entry?.signedInAt === 'number' ? entry.signedInAt : 0,
          refreshRefused: entry?.refreshRefused === true
        })
      }
    }
    return accounts
  } catch {
    return null
  }
}

/** The list was there and could not be read: either the keystore threw, or what it holds does not
 *  parse. Every write path stops here, because writing the list it could not read would sign every
 *  account out (review of 2026-10-14: one failed read before a 401 wrote `[]` over two accounts). */
export class AccountsUnreadableError extends Error {
  constructor(reason: string) {
    super(`the saved sign-ins could not be read (${reason}); nothing was changed`)
    this.name = 'AccountsUnreadableError'
  }
}

async function writeAccounts(accounts: readonly StoredAccount[]): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify({ accounts }))
}

function newPendingId(): string {
  return `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Moves a sign-in from the single-account builds in as the first account, keeping its cached
 *  organization. The old keys go only after the new list is written, so a failed write loses
 *  nothing: the user stays signed in and the move is tried again on the next read. */
async function migrateLegacySignIn(): Promise<StoredAccount[]> {
  const raw = await SecureStore.getItemAsync(STORE_KEY)
  let credential: StoredCredential | null = null
  try {
    credential = raw ? parseCredential(JSON.parse(raw)) : null
  } catch {
    credential = null
  }
  if (!credential) {
    return []
  }
  let accountUuid: string | null = null
  let organizationUuid: string | null = null
  try {
    const cached = JSON.parse((await SecureStore.getItemAsync(ORG_STORE_KEY)) ?? 'null') as Partial<CcrProfile> | null
    accountUuid = textOrNull(cached?.accountUuid)
    organizationUuid = textOrNull(cached?.organizationUuid)
  } catch {
    // An unreadable cache only means the organization is asked again.
  }
  const accounts: StoredAccount[] = [
    { id: accountUuid ?? newPendingId(), credential, accountUuid, organizationUuid, organizationName: null, signedInAt: 0, refreshRefused: false }
  ]
  await writeAccounts(accounts)
  await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(ORG_STORE_KEY).catch(() => undefined)
  return accounts
}

/** The stored list. Absent means nobody signed in on this build yet (a sign-in from an earlier one
 *  is moved in); a read that throws, or a value that does not parse, throws AccountsUnreadableError
 *  rather than reading as an empty list. */
async function loadAccounts(): Promise<StoredAccount[]> {
  await SecureStore.deleteItemAsync(PRE_SCOPES_STORE_KEY).catch(() => undefined)
  let raw: string | null
  try {
    raw = await SecureStore.getItemAsync(ACCOUNTS_KEY)
  } catch (error) {
    throw new AccountsUnreadableError(error instanceof Error ? error.message : String(error))
  }
  if (raw === null) {
    return migrateLegacySignIn()
  }
  const stored = parseAccounts(raw)
  if (!stored) {
    throw new AccountsUnreadableError('the stored value is not a list of accounts')
  }
  return stored
}

/** Every signed-in account, in sign-in order. The first is the primary. */
export function listAccounts(): Promise<StoredAccount[]> {
  return withAccounts(loadAccounts)
}

/**
 * Signs an account in. The same account twice (same account uuid) replaces its entry, in place, so
 * the primary stays the primary. Otherwise the sign-in takes the place of the first entry that is
 * both signed out (isAccountUsable) and unidentified, if there is one: that entry can never be
 * identified (its profile needs a working token) so it can never be merged, and its only use was
 * to say "sign in again", which the user just did. Left in place it stayed the primary that
 * dictation read, and the list showed it beside the new sign-in (review of 2026-10-14). If it was
 * a different account after all, it held nothing that still worked; that account signs in again.
 */
export function upsertAccount(credential: StoredCredential, profile: CcrProfile | null): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    const fresh: StoredAccount = {
      id: profile?.accountUuid ?? newPendingId(),
      credential,
      accountUuid: profile?.accountUuid ?? null,
      organizationUuid: profile?.organizationUuid ?? null,
      organizationName: profile?.organizationName ?? null,
      signedInAt: Date.now(),
      refreshRefused: false
    }
    let at = profile ? accounts.findIndex((account) => account.id === fresh.id) : -1
    if (at === -1) {
      const now = Date.now()
      at = accounts.findIndex((account) => account.accountUuid === null && !isAccountUsable(account, now))
    }
    await writeAccounts(at === -1 ? [...accounts, fresh] : accounts.map((account, index) => (index === at ? fresh : account)))
  }).then(notifyAnthropicAccountsChanged)
}

/** Of two entries for one account, the one whose credential to keep: one that still works over one
 *  that does not, then the later sign-in; on a tie, `first`. */
function newerOf(first: StoredAccount, second: StoredAccount): StoredAccount {
  const now = Date.now()
  const firstUsable = isAccountUsable(first, now)
  if (firstUsable !== isAccountUsable(second, now)) {
    return firstUsable ? first : second
  }
  return second.signedInAt > first.signedInAt ? second : first
}

/** Stores the profile the sessions path read for an account signed in without one. When that
 *  account turns out to be one already listed, the two become one entry (the earlier place, the
 *  newer sign-in). */
export function rememberAccountProfile(id: string, profile: CcrProfile): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    const me = accounts.find((account) => account.id === id)
    if (!me) {
      return false
    }
    const twinAt = accounts.findIndex((account) => account.id === profile.accountUuid && account.id !== id)
    const twin = twinAt === -1 ? null : accounts[twinAt]!
    // Merged, the entry keeps the newer sign-in's credential, whichever of the two holds it.
    const kept = twin ? newerOf(me, twin) : me
    const identified: StoredAccount = {
      ...kept,
      id: profile.accountUuid,
      accountUuid: profile.accountUuid,
      organizationUuid: profile.organizationUuid,
      organizationName: profile.organizationName
    }
    const meAt = accounts.indexOf(me)
    const place = twin ? Math.min(meAt, twinAt) : meAt
    const next = accounts.flatMap((account, index) => (index === place ? [identified] : account === me || account === twin ? [] : [account]))
    await writeAccounts(next)
    return twin !== null
  }).then((merged) => {
    // Two entries became one: the accounts changed. Naming a pending entry alone does not.
    if (merged) {
      notifyAnthropicAccountsChanged()
    }
  })
}

/** Drops an account's cached organization, so the profile is asked again (it went stale). */
export function forgetAccountOrganization(id: string): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    await writeAccounts(accounts.map((account) => (account.id === id ? { ...account, organizationUuid: null } : account)))
  })
}

/** Signs one account out; the others stay signed in. */
export function removeAccount(id: string): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    await writeAccounts(accounts.filter((account) => account.id !== id))
  }).then(notifyAnthropicAccountsChanged)
}

/** Writes a refreshed credential over the account that held the old one (matched by its refresh
 *  token, which is unique to the account). A credential no account holds is not stored. */
export function replaceCredentialOf(old: StoredCredential, fresh: StoredCredential): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    if (accounts.some((account) => holds(account, old))) {
      await writeAccounts(accounts.map((account) => (holds(account, old) ? { ...account, credential: fresh, refreshRefused: false } : account)))
    }
  })
}

function holds(account: StoredAccount, credential: StoredCredential): boolean {
  return credential.refreshToken ? account.credential.refreshToken === credential.refreshToken : account.credential.accessToken === credential.accessToken
}

/** Marks the account holding this credential as refused by the token endpoint: once its access
 *  token runs out it reads as signed out, and its refresh token is not spent again. */
export function markRefreshRefused(credential: StoredCredential): Promise<void> {
  return withAccounts(async () => {
    const accounts = await loadAccounts()
    if (accounts.some((account) => holds(account, credential) && !account.refreshRefused)) {
      await writeAccounts(accounts.map((account) => (holds(account, credential) ? { ...account, refreshRefused: true } : account)))
    }
  })
}

/** The account dictation uses: the first one still signed in (isAccountUsable). A primary whose
 *  sign-in died is passed over, so a newer sign-in answers instead of a token that cannot work. */
export async function readPrimaryAccount(): Promise<StoredAccount | null> {
  const now = Date.now()
  return (await listAccounts()).find((account) => isAccountUsable(account, now)) ?? null
}

/** The primary account's credential: what dictation uses. */
export async function readCredential(): Promise<StoredCredential | null> {
  return (await readPrimaryAccount())?.credential ?? null
}

/** A label for the account in the list and in log lines: its organization's name. */
export function accountLabel(account: StoredAccount, index: number): string {
  return account.organizationName ?? `Account ${index + 1}`
}

/** Signs every account out, and drops a sign-in the single-account builds left behind. */
export async function clearAccounts(): Promise<void> {
  await withAccounts(async () => {
    await SecureStore.deleteItemAsync(ACCOUNTS_KEY).catch(() => undefined)
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined)
    await SecureStore.deleteItemAsync(ORG_STORE_KEY).catch(() => undefined)
  })
  notifyAnthropicAccountsChanged()
}
