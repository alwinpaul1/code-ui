import { useEffect, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
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

// Loads repo eligibility independently from branch/SHA. The header PR icon only
// needs the cheap GitHub probe; the panel can keep loading branch context after
// the entry point is already stable in the top bar.
//
// `includeBranchIdentity: false` skips git.status + branchCompare — use when the
// caller only gates a PR entry on hosted-repo eligibility (session dock icon).
export function useMobilePrBranchContext(input: {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  includeBranchIdentity?: boolean
}): MobilePrBranchContext {
  const { client, connState, worktreeId, includeBranchIdentity = true } = input
  const [context, setContext] = useState<MobilePrBranchContext>({
    branch: null,
    headSha: null,
    status: null,
    isGithubRepo: false,
    repoLoaded: false,
    loaded: false
  })

  const ready = client !== null && connState === 'connected'

  useEffect(() => {
    let cancelled = false
    if (!ready || !client) {
      setContext({
        branch: null,
        headSha: null,
        status: null,
        isGithubRepo: false,
        repoLoaded: false,
        loaded: !includeBranchIdentity
      })
      return
    }
    setContext({
      branch: null,
      headSha: null,
      status: null,
      isGithubRepo: false,
      repoLoaded: false,
      // Repo-only mode is "loaded" for branch fields immediately (they stay null).
      loaded: !includeBranchIdentity
    })

    void loadMobilePrRepoContext(client, worktreeId)
      .then((next) => {
        if (!cancelled) {
          setContext((prev) => ({
            ...prev,
            isGithubRepo: next.isGithubRepo,
            repoLoaded: true
          }))
        }
      })
      // Why: a failed repo probe is not an answer. Marking it loaded-and-not-GitHub closed a docked
      // PR panel on a GitHub repo over one relay timeout (the session reads that pair to close it);
      // repoLoaded stays false, and the next connection probes again (this effect keys on `ready`).
      // Branch context still loads, so the panel's own loading/error state keeps working.
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn(
            `[pr-branch-context] could not check whether ${worktreeId} has a GitHub remote: ${
              error instanceof Error ? error.message || 'no reason given' : String(error)
            }`
          )
        }
      })

    if (!includeBranchIdentity) {
      return () => {
        cancelled = true
      }
    }

    void loadMobilePrBranchIdentity(client, worktreeId)
      .then((next) => {
        if (!cancelled) {
          setContext((prev) => ({
            ...prev,
            ...next,
            loaded: true
          }))
        }
      })
      // Why: a rejected branch read must not escape as an unhandled rejection;
      // keep repo eligibility and let the panel show "branch unavailable".
      .catch(() => {
        if (!cancelled) {
          setContext((prev) => ({
            ...prev,
            branch: null,
            headSha: null,
            status: null,
            loaded: true
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [ready, client, worktreeId, includeBranchIdentity])

  return context
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
