import { useCallback, useEffect, useState } from 'react'
import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import {
  claudeSessionAvailable,
  lastClaudeSessionAccount,
  seedClaudeSession,
  subscribeClaudeSessionChanged
} from './claude-ai-session'
import { readClaudeArtifactAccounts, type ClaudeArtifactAccount } from './claude-artifact-list-store'

/**
 * Whose claude.ai session the viewer opens an artifact with, and whether it has one.
 *  - `checking`: still deciding, or writing the session into the jar; no WebView may mount yet,
 *    or it would load with whatever session the jar held before.
 *  - `ready`: load the page. `accountId` is the account it is signed in as, or null where the
 *    phone keeps no claude.ai sessions (no native module) and claude.ai's own page answers.
 *  - `needed`: no session to open it with. `accountId` is the account it belongs to when known;
 *    with none known, `choices` are the signed-in accounts to pick from (empty: nobody is
 *    signed in to Code UI at all).
 */
export type ArtifactViewerSession =
  | { kind: 'checking' }
  | { kind: 'ready'; accountId: string | null }
  | { kind: 'needed'; accountId: string | null; label: string | null; choices: readonly ClaudeArtifactAccount[] }

/**
 * The account an artifact opens as: the one the opener named (the gallery's selected account, a
 * chat's tab account) when it is still signed in; else the only account, which can be nobody
 * else's; else the one the viewer last opened an artifact as; else none, and the user picks.
 */
export function resolveArtifactViewerAccount(
  requested: string | null,
  accounts: readonly ClaudeArtifactAccount[],
  last: string | null
): string | null {
  const signedIn = (id: string | null): id is string => id !== null && accounts.some((account) => account.id === id)
  if (signedIn(requested)) {
    return requested
  }
  if (accounts.length === 1) {
    return accounts[0]!.id
  }
  return signedIn(last) ? last : null
}

/**
 * Decides the viewer's account and writes that account's claude.ai session into the WebView's
 * jar before the page loads (seedClaudeSession replaces any other account's). Asks again when a
 * session is stored or forgotten or the sign-ins change, so returning from the in-app sign-in
 * opens the artifact by itself. `choose` is the user's pick when no account could be told.
 */
export function useArtifactViewerSession(requested: string | null): {
  session: ArtifactViewerSession
  choose: (accountId: string) => void
} {
  const [session, setSession] = useState<ArtifactViewerSession>(() =>
    claudeSessionAvailable() ? { kind: 'checking' } : { kind: 'ready', accountId: requested }
  )
  const [chosen, setChosen] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const again = () => setEpoch((n) => n + 1)
    const offSession = subscribeClaudeSessionChanged(again)
    const offAccounts = subscribeAnthropicAccountsChanged(again)
    return () => {
      offSession()
      offAccounts()
    }
  }, [])

  useEffect(() => {
    if (!claudeSessionAvailable()) {
      setSession({ kind: 'ready', accountId: requested })
      return
    }
    let stale = false
    void (async () => {
      let accounts: ClaudeArtifactAccount[]
      try {
        accounts = await readClaudeArtifactAccounts()
      } catch (error) {
        console.warn(`[artifacts] the viewer could not read the signed-in accounts: ${error instanceof Error ? error.message : String(error)}`)
        accounts = []
      }
      const accountId = resolveArtifactViewerAccount(chosen ?? requested, accounts, await lastClaudeSessionAccount())
      if (stale) {
        return
      }
      if (accountId === null) {
        setSession({ kind: 'needed', accountId: null, label: null, choices: accounts })
        return
      }
      // Only once the seed is in may the page load (a stale result must not mount it either).
      const seeded = await seedClaudeSession(accountId)
      if (stale) {
        return
      }
      if (seeded === 'none') {
        const label = accounts.find((account) => account.id === accountId)?.label ?? null
        setSession({ kind: 'needed', accountId, label, choices: accounts })
      } else {
        // `unavailable`: the module failed; claude.ai's own page is better than a dead end.
        setSession({ kind: 'ready', accountId })
      }
    })()
    return () => {
      stale = true
    }
  }, [requested, chosen, epoch])

  const choose = useCallback((accountId: string) => {
    setSession({ kind: 'checking' })
    setChosen(accountId)
  }, [])
  return { session, choose }
}
