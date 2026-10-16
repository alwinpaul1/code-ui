import { useEffect, useState, useSyncExternalStore } from 'react'
import { fetchClaudeArtifactList, type ClaudeArtifactListItem } from './claude-artifacts'
import type { CcrLinkAuth } from './ccr-session-link-types'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/**
 * Each signed-in account's artifact list (claude-artifacts.ts), kept in memory and shared by every
 * screen that shows it: the session's Artifacts sheet, and the cards and chips that take an
 * artifact's title from it. One read per account at a time; a read younger than
 * CLAUDE_ARTIFACT_LIST_FRESH_MS is not repeated unless asked (`force`, the sheet's pull to
 * refresh). A failed read keeps the rows an earlier one returned and says why beside them.
 */

export const CLAUDE_ARTIFACT_LIST_FRESH_MS = 30_000

export type ClaudeArtifactListState = {
  items: readonly ClaudeArtifactListItem[]
  /** Epoch ms of the last read that answered, or null before one has. */
  loadedAt: number | null
  loading: boolean
  /** Why the last read failed, in a few words, or null. */
  error: string | null
}

const EMPTY: ClaudeArtifactListState = { items: [], loadedAt: null, loading: false, error: null }

const states = new Map<string, ClaudeArtifactListState>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0

type ListDeps = { load: () => Promise<CcrPipelineDeps>; now: () => number }
let deps: ListDeps = { load: loadDefaultCcrPipelineDeps, now: Date.now }

/** For tests: the deps a read uses, and a clean slate. */
export function setClaudeArtifactListDepsForTests(next: Partial<ListDeps> | null): void {
  deps = next === null ? { load: loadDefaultCcrPipelineDeps, now: Date.now } : { ...deps, ...next }
  states.clear()
  inFlight.clear()
  version++
}

function set(accountId: string, next: ClaudeArtifactListState): void {
  states.set(accountId, next)
  version++
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeClaudeArtifactLists(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function claudeArtifactListsVersion(): number {
  return version
}

export function claudeArtifactListFor(accountId: string | null): ClaudeArtifactListState {
  return (accountId && states.get(accountId)) || EMPTY
}

/** The pipeline's sign-ins as a session link's `auth`: the account's token, or null. */
function authFrom(pipeline: CcrPipelineDeps) {
  return async (accountId: string): Promise<CcrLinkAuth | null> => {
    const [account] = await pipeline.accounts.list(accountId)
    return account?.accessToken ? { token: account.accessToken, organizationUuid: account.organizationUuid ?? '' } : null
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the list could not be read'
}

/** Reads the account's list unless a fresh one is held (or one is being read). */
export function refreshClaudeArtifactList(accountId: string, options: { force?: boolean } = {}): Promise<void> {
  const running = inFlight.get(accountId)
  if (running) {
    return running
  }
  const held = claudeArtifactListFor(accountId)
  if (!options.force && held.loadedAt !== null && deps.now() - held.loadedAt < CLAUDE_ARTIFACT_LIST_FRESH_MS) {
    return Promise.resolve()
  }
  set(accountId, { ...held, loading: true })
  const read = (async () => {
    try {
      const pipeline = await deps.load()
      const items = await fetchClaudeArtifactList({ fetch: pipeline.fetch, auth: authFrom(pipeline) }, accountId)
      set(accountId, { items, loadedAt: deps.now(), loading: false, error: null })
    } catch (error) {
      const reason = reasonOf(error)
      console.warn('[artifacts] the account artifact list could not be read', { reason })
      set(accountId, { ...claudeArtifactListFor(accountId), loading: false, error: reason })
    } finally {
      inFlight.delete(accountId)
    }
  })()
  inFlight.set(accountId, read)
  return read
}

/** The account's list, read once on mount (and again when the account changes). */
export function useClaudeArtifactList(accountId: string | null): ClaudeArtifactListState {
  useSyncExternalStore(subscribeClaudeArtifactLists, claudeArtifactListsVersion, claudeArtifactListsVersion)
  useEffect(() => {
    if (accountId) {
      void refreshClaudeArtifactList(accountId)
    }
  }, [accountId])
  return claudeArtifactListFor(accountId)
}

/** One signed-in account as the gallery's account picker names it. */
export type ClaudeArtifactAccount = { id: string; label: string }

/** The signed-in accounts, in sign-in order (the first is the primary), read through the same
 *  deps as the lists so a test can stand in for both. */
export async function readClaudeArtifactAccounts(): Promise<ClaudeArtifactAccount[]> {
  const pipeline = await deps.load()
  return (await pipeline.accounts.list()).map((account) => ({ id: account.id, label: account.label }))
}

/** The label of a signed-in account (its name as the sign-in list gives it), or null while it is
 *  read, when there is no account, or when the read fails. */
export function useClaudeArtifactAccountLabel(accountId: string | null): string | null {
  const [label, setLabel] = useState<{ id: string; label: string } | null>(null)
  useEffect(() => {
    if (!accountId) {
      return
    }
    let live = true
    readClaudeArtifactAccounts().then(
      (accounts) => {
        const found = accounts.find((account) => account.id === accountId)
        if (live) {
          setLabel(found ? { id: accountId, label: found.label } : null)
        }
      },
      (error: unknown) => console.warn(`[artifacts] the account's name could not be read: ${reasonOf(error)}`)
    )
    return () => {
      live = false
    }
  }, [accountId])
  return accountId && label?.id === accountId ? label.label : null
}
