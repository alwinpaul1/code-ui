import { useEffect, useState, useSyncExternalStore } from 'react'
import { ccrAccountForConfigDir, ccrAccountForTab } from './ccr-session-cache'
import { ccrSignedInAccountCount, ccrUsageVersion, subscribeCcrUsage } from './ccr-session-usage'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/** What names a Claude tab's Anthropic account (use-ccr-session-usage.ts reads the same four). */
export type ClaudeTabAccountScope = {
  tabId: string
  epoch: number | null
  agentSessionId: string | null
  /** The Claude config dir the tab's session writes under, from its transcript path. */
  configDir: string | null
}

/**
 * The account a Claude tab's artifacts are listed under: the one its session is matched to, else
 * the one its config dir is bound to, else — with exactly one account signed in — that one, since
 * it can be nobody else's. With several signed in and none named, null: listing one of them under
 * this session could show the work account's pages in a personal session.
 *
 * The signed-in count comes from the usage store (ccr-session-usage.ts), which only says how many;
 * the one account's id is read once from the sign-ins when that count is 1.
 */
export function useClaudeTabAccount(
  scope: ClaudeTabAccountScope | null,
  load: () => Promise<CcrPipelineDeps> = loadDefaultCcrPipelineDeps
): string | null {
  useSyncExternalStore(subscribeCcrUsage, ccrUsageVersion, ccrUsageVersion)
  const known = scope
    ? (ccrAccountForTab(scope.tabId, scope.epoch, scope.agentSessionId, scope.configDir) ??
      (scope.configDir ? ccrAccountForConfigDir(scope.configDir) : null))
    : null
  const wantOnly = scope !== null && known === null && ccrSignedInAccountCount() === 1
  const [only, setOnly] = useState<string | null>(null)
  useEffect(() => {
    if (!wantOnly) {
      return
    }
    let stale = false
    void load()
      .then((deps) => deps.accounts.list())
      .then(
        (entries) => {
          if (!stale) {
            setOnly(entries.length === 1 ? (entries[0]?.id ?? null) : null)
          }
        },
        (error: unknown) => {
          console.warn(`[artifacts] the signed-in account could not be read: ${error instanceof Error ? error.message : String(error)}`)
        }
      )
    return () => {
      stale = true
    }
  }, [wantOnly, load])
  return known ?? (wantOnly ? only : null)
}
