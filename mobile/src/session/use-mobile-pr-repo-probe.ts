import { useCallback, useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { fetchGithubRepoSlug } from './github-pr-rpc'

/**
 * Whether the worktree's repo has a GitHub remote: the PR icon, the header chip and the Pull
 * Request segment all hang off it.
 *
 * `failed` is not `not-github`. `github.repoSlug` settles every throw (a relay timeout, an in-band
 * refusal, a reply that would not parse) into `{ ok: false }`, and reading that as "no GitHub
 * remote" told a GitHub repo, for good, that its provider had no review panel. A failed probe
 * says so and can be retried; only the host's own `null` slug means "not GitHub".
 */
export type MobilePrRepoProbe = 'pending' | 'github' | 'not-github' | 'failed'

export function useMobilePrRepoProbe(args: {
  client: RpcClient | null
  // Connected with a client. The probe is branch-independent (repo eligibility is): requiring a
  // branch would strand a detached-HEAD worktree on a forever spinner.
  ready: boolean
  worktreeId: string
}): { probe: MobilePrRepoProbe; retry: () => void } {
  const { client, ready, worktreeId } = args
  const [probe, setProbe] = useState<MobilePrRepoProbe>('pending')
  const [attempt, setAttempt] = useState(0)

  // A worktree change resets it; a brief disconnect must not (else the chip hides mid-session).
  useEffect(() => {
    setProbe('pending')
  }, [worktreeId])

  // Runs again on each new connection (`ready` goes false, then true), never while the host is
  // down, and on Retry.
  useEffect(() => {
    let cancelled = false
    if (!ready || !client) {
      return
    }
    const settle = (next: MobilePrRepoProbe, why?: string): void => {
      if (cancelled) {
        return
      }
      if (why !== undefined) {
        console.warn(
          `[pr-sidebar] could not check whether ${worktreeId} has a GitHub remote: ${why || 'no reason given'}`
        )
      }
      setProbe(next)
    }
    void fetchGithubRepoSlug(client, worktreeId)
      .then((outcome) =>
        outcome.ok
          ? settle(outcome.result !== null ? 'github' : 'not-github')
          : settle('failed', outcome.error)
      )
      // Why: fetchGithubRepoSlug settles throws itself, but a stray rejection must not surface as
      // LogBox, and it is a failure like any other, not an answer.
      .catch((error: unknown) =>
        settle('failed', error instanceof Error ? error.message : String(error))
      )
    return () => {
      cancelled = true
    }
  }, [ready, client, worktreeId, attempt])

  const retry = useCallback(() => {
    // Show the check in flight; with no connection nothing can be in flight, and the next
    // connection re-runs the probe by itself.
    if (ready) {
      setProbe('pending')
    }
    setAttempt((count) => count + 1)
  }, [ready])

  return { probe, retry }
}
