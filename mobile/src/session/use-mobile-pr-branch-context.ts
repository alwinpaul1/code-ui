import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import type { MobileGitBranchCompareResult } from '../source-control/mobile-branch-compare'
import type { MobileGitStatusResult } from '../source-control/mobile-git-status'
import { resolveMobileBranchCompareBaseRef } from '../source-control/mobile-branch-base-ref'
import { fetchGithubRepoSlug } from './github-pr-rpc'
import { branchContextCompareRead, branchContextStatusRead } from './mobile-diff-review-operations'

export type MobilePrBranchContext = {
  branch: string | null
  headSha: string | null
  status: MobileGitStatusResult | null
  isGithubRepo: boolean
  repoLoaded: boolean
  loaded: boolean
}

// Pure derivation of branch + head SHA from a git.status + git.branchCompare snapshot.
// Head SHA must match the review path's precedence (use-mobile-diff-review-controller.ts):
// `status.head ?? branchCompare.summary.headOid ?? null` — a status-only read would lose
// the SHA when `status.head` is absent and diverge from the review surface's check status.
export function deriveMobilePrBranchContext(
  status: MobileGitStatusResult | null,
  branchCompare: MobileGitBranchCompareResult | null
): { branch: string | null; headSha: string | null; status: MobileGitStatusResult | null } {
  return {
    branch: status?.branch ?? null,
    headSha: status?.head ?? branchCompare?.summary.headOid ?? null,
    status
  }
}

/**
 * Tries after a failed repo probe while the connection stays up: two more, with backoff, then none
 * until the host connects again. One relay timeout used to hide the session's PR entry and checks
 * action for the rest of the visit, since nothing but a flip of `ready` probed again (review round
 * 3, 2026-09-30). A timer never outlives the connection it was set on, so a host that is down is
 * never probed.
 */
export const PR_REPO_PROBE_RETRY_DELAYS_MS = [2_000, 8_000] as const

type RepoProbe = { status: 'pending' | 'answered' | 'failed'; isGithubRepo: boolean }

const REPO_PROBE_PENDING: RepoProbe = { status: 'pending', isGithubRepo: false }

// Loads repo eligibility independently from branch/SHA. The header PR icon only
// needs the cheap GitHub probe; the panel can keep loading branch context after
// the entry point is already stable in the top bar.
//
// `includeBranchIdentity: false` skips git.status + branchCompare — use when the
// caller only gates a PR entry on hosted-repo eligibility (session dock icon).
//
// `lastConnectedAt` moves on each new connection to the host. A failed probe runs again when it
// does, even while connState stays 'connected' (a LAN->relay migration), because the client is the
// same object across the swap.
export function useMobilePrBranchContext(input: {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  includeBranchIdentity?: boolean
  lastConnectedAt?: number | null
}): MobilePrBranchContext {
  const { client, connState, worktreeId, includeBranchIdentity = true } = input
  const ready = client !== null && connState === 'connected'
  const repo = useSessionPrRepoProbe({
    client,
    ready,
    worktreeId,
    lastConnectedAt: input.lastConnectedAt ?? null
  })
  const [identity, setIdentity] = useState<
    Pick<MobilePrBranchContext, 'branch' | 'headSha' | 'status' | 'loaded'>
  >({ branch: null, headSha: null, status: null, loaded: false })

  useEffect(() => {
    let cancelled = false
    // Repo-only mode is "loaded" for branch fields immediately (they stay null).
    setIdentity({ branch: null, headSha: null, status: null, loaded: !includeBranchIdentity })
    if (!ready || !client || !includeBranchIdentity) {
      return
    }
    void loadMobilePrBranchIdentity(client, worktreeId)
      .then((next) => {
        if (!cancelled) {
          setIdentity({ ...next, loaded: true })
        }
      })
      // Why: a rejected branch read must not escape as an unhandled rejection;
      // keep repo eligibility and let the panel show "branch unavailable".
      .catch(() => {
        if (!cancelled) {
          setIdentity({ branch: null, headSha: null, status: null, loaded: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [ready, client, worktreeId, includeBranchIdentity])

  return useMemo(
    () => ({
      ...identity,
      isGithubRepo: repo.status === 'answered' && repo.isGithubRepo,
      repoLoaded: repo.status === 'answered'
    }),
    [identity, repo]
  )
}

function useSessionPrRepoProbe(args: {
  client: RpcClient | null
  ready: boolean
  worktreeId: string
  lastConnectedAt: number | null
}): RepoProbe {
  const { client, ready, worktreeId, lastConnectedAt } = args
  const [probe, setProbe] = useState<RepoProbe>(REPO_PROBE_PENDING)
  // Bumped by a backoff timer or a new connection; the probe effect keys on it.
  const [attempt, setAttempt] = useState(0)
  const retriesUsed = useRef(0)
  const staleLedger = useRef(createStaleAfterReconnectLedger())

  // A connection coming or going, or another worktree, starts over with a fresh retry budget.
  useEffect(() => {
    retriesUsed.current = 0
    setProbe(REPO_PROBE_PENDING)
  }, [ready, client, worktreeId])

  useEffect(() => {
    if (!ready || !client) {
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    void loadMobilePrRepoContext(client, worktreeId)
      .then((next) => {
        if (!cancelled) {
          setProbe({ status: 'answered', isGithubRepo: next.isGithubRepo })
        }
      })
      // Why: a failed repo probe is not an answer. Marking it loaded-and-not-GitHub closed a docked
      // PR panel on a GitHub repo over one relay timeout (the session reads that pair to close it);
      // repoLoaded stays false. It is tried again a bounded number of times while connected, and
      // once more on each new connection. Branch context still loads, so the panel's own
      // loading/error state keeps working.
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        const delay = PR_REPO_PROBE_RETRY_DELAYS_MS[retriesUsed.current]
        const next =
          delay === undefined
            ? 'not trying again until the next connection'
            : `trying again in ${delay / 1000}s`
        console.warn(
          `[pr-branch-context] could not check whether ${worktreeId} has a GitHub remote: ${
            error instanceof Error ? error.message || 'no reason given' : String(error)
          }; ${next}`
        )
        setProbe((previous) =>
          previous.status === 'failed' ? previous : { status: 'failed', isGithubRepo: false }
        )
        if (delay !== undefined) {
          retriesUsed.current += 1
          retryTimer = setTimeout(() => setAttempt((count) => count + 1), delay)
        }
      })
    return () => {
      cancelled = true
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
    }
  }, [ready, client, worktreeId, attempt])

  // One more probe per NEW connection after a failure, never one per render.
  useEffect(() => {
    if (!ready) {
      return
    }
    const status =
      probe.status === 'failed' ? 'error' : probe.status === 'answered' ? 'ready' : 'loading'
    if (shouldRefetchAfterReconnect(staleLedger.current, 'repo', status, lastConnectedAt)) {
      retriesUsed.current = 0
      setAttempt((count) => count + 1)
    }
  }, [ready, probe.status, lastConnectedAt])

  return probe
}

export async function loadMobilePrBranchContext(
  client: RpcClient,
  worktreeId: string
): Promise<MobilePrBranchContext> {
  const [branch, repo] = await Promise.all([
    loadMobilePrBranchIdentity(client, worktreeId),
    // A failed probe leaves the repo unknown (repoLoaded false), never "not GitHub".
    loadMobilePrRepoContext(client, worktreeId).catch(() => null)
  ])
  return repo
    ? { ...branch, ...repo, repoLoaded: true, loaded: true }
    : { ...branch, isGithubRepo: false, repoLoaded: false, loaded: true }
}

/**
 * Whether the repo has a GitHub remote. Only the host's own answer resolves: a probe that failed
 * (a relay timeout, a refusal, a reply that would not parse) REJECTS with its cause, because
 * `github.repoSlug` settles every one of those into `{ ok: false }`, and reading that as
 * `isGithubRepo: false` claimed a GitHub repo had no review panel.
 */
export async function loadMobilePrRepoContext(
  client: RpcClient,
  worktreeId: string
): Promise<Pick<MobilePrBranchContext, 'isGithubRepo'>> {
  const slugOutcome = await fetchGithubRepoSlug(client, worktreeId)
  if (!slugOutcome.ok) {
    throw new Error(slugOutcome.error)
  }
  return { isGithubRepo: slugOutcome.result !== null }
}

export async function loadMobilePrBranchIdentity(
  client: RpcClient,
  worktreeId: string
): Promise<Pick<MobilePrBranchContext, 'branch' | 'headSha' | 'status'>> {
  const [status, branchCompare] = await Promise.all([
    readGitStatus(client, worktreeId),
    // Why: the standalone PR entry point only needs branchCompare as a head-SHA
    // fallback; compare failures must not hide the PR panel when git.status works.
    readBranchCompare(client, worktreeId).catch(() => null)
  ])
  return deriveMobilePrBranchContext(status, branchCompare)
}

async function readGitStatus(
  client: RpcClient,
  worktreeId: string
): Promise<MobileGitStatusResult | null> {
  const reply = await branchContextStatusRead.request(client, { worktree: `id:${worktreeId}` })
  const status = branchContextStatusRead.interpret(reply)
  return status.accepted ? status.value : null
}

async function readBranchCompare(
  client: RpcClient,
  worktreeId: string
): Promise<MobileGitBranchCompareResult | null> {
  // branchCompare requires a baseRef; without one (or on error) the headOid fallback is
  // simply unavailable and headSha relies on status.head.
  const baseRef = await resolveMobileBranchCompareBaseRef(client, worktreeId)
  if (!baseRef) {
    return null
  }
  const reply = await branchContextCompareRead.request(client, {
    worktree: `id:${worktreeId}`,
    baseRef
  })
  const compared = branchContextCompareRead.interpret(reply)
  return compared.accepted ? compared.value : null
}
