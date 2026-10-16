import { useEffect, useState } from 'react'
import { readClaudeArtifactAccounts, useClaudeArtifactList } from './claude-artifact-list-store'

/**
 * Whether the artifact the viewer shows is the user's own: a `mine` row in the artifact list of the
 * one Anthropic account signed in on the phone. The Claude app offers Share and Add to home screen
 * only for its own artifacts and Open in browser for the rest (sq30.java:4155-4290).
 *
 * The viewer has no tab to name an account by (use-claude-tab-account.ts), so it takes the only
 * account, which can be nobody else's; with none or several signed in it cannot tell whose the
 * artifact is and treats it as not the user's own. The sign-ins are read directly rather than
 * through the usage store's count (ccrSignedInAccountCount), which stays unknown until a Claude
 * tab has read its usage, and a link from another app can open the viewer before any has. They
 * are read through the list store's deps (readClaudeArtifactAccounts), the same the list uses.
 *
 * Until the list has answered, false: the bar starts on Open in browser and turns to Share when the
 * row arrives.
 */
export function useArtifactViewerOwnsArtifact(uuid: string): boolean {
  const [accountId, setAccountId] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    void readClaudeArtifactAccounts().then(
      (entries) => {
        if (!stale) {
          setAccountId(entries.length === 1 ? (entries[0]?.id ?? null) : null)
        }
      },
      (error: unknown) => {
        console.warn(`[artifacts] the viewer could not read the signed-in accounts: ${error instanceof Error ? error.message : String(error)}`)
      }
    )
    return () => {
      stale = true
    }
  }, [])
  const list = useClaudeArtifactList(accountId)
  const wanted = uuid.toLowerCase()
  return list.items.some((item) => item.uuid.toLowerCase() === wanted && item.rel === 'mine')
}
