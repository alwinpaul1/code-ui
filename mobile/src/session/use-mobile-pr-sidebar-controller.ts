import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchHostedReviewForBranch,
  fetchPRChecks,
  fetchPRForBranch,
  fetchWorkItemDetails
} from './github-pr-rpc'
import {
  loadPrSidebarData,
  loadPrSidebarDetails,
  prSidebarDetailsNeedFetch,
  resolvePrSidebarDetailsAfterPhase2,
  shouldApplyResult,
  shouldSoftRefreshPrSidebarOnHeadChange,
  type PrSidebarLoadDeps,
  type PrSidebarState
} from './mobile-pr-sidebar-state'
import { fetchWorktreeLinkedPR } from '../source-control/mobile-pr-link'
import { useMobilePrRepoProbe } from './use-mobile-pr-repo-probe'
import { useMobilePrSidebarReconnectRefetch } from './use-mobile-pr-sidebar-reconnect'

type PrSidebarControllerInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  // branch/headSha come from git.status (not the branchCompare base ref nor worktree metadata, which carries no branch).
  branch: string | null
  headSha: string | null
  // useLastConnectedAt(hostId): a failed load is read again once per NEW connection. Required, so
  // no surface can opt out by leaving it off: Diff Review did, and its PR sidebar sat on a failed
  // load over a healthy connection until the user tapped Retry (review round 2, 2026-09-30).
  lastConnectedAt: number | null
}

// Load options: the hub chip needs only phase 1 (PR + checks); phase 2 (comments/body) is heavy and waits until the PR segment opens.
export type PrSidebarLoadOptions = {
  includeDetails?: boolean
}

// Identity is worktree + branch only: headSha advances every commit and must not wipe a ready chip to "loading" (soft-refresh handles it).
export function buildMobilePrSidebarIdentity(args: {
  worktreeId: string
  branch: string | null
}): string | null {
  return args.branch ? `${args.worktreeId}\u0000${args.branch}` : null
}

export function useMobilePrSidebarController(input: PrSidebarControllerInput) {
  const { client, connState, worktreeId, branch, headSha } = input
  const [state, setState] = useState<PrSidebarState>({ kind: 'hidden' })
  const [showPRSidebar, setShowPRSidebar] = useState(false)
  const loadSeqRef = useRef(0)
  // Separate seq for phase-2 fetches so they can't cancel a concurrent phase-1 soft refresh (and vice versa).
  const detailsSeqRef = useRef(0)
  // (seq, prNumber) of the in-flight phase-2 fetch; without this claim every cold PR-segment open fetched the heavy details twice.
  const detailsInFlightRef = useRef<{ seq: number; prNumber: number } | null>(null)
  const stateIdentityRef = useRef<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const headShaRef = useRef(headSha)
  // What the latest load asked for, so a reconnect repeats that load and not a heavier one.
  const lastLoadIncludedDetailsRef = useRef(true)

  // PR icon shows for any GitHub remote, regardless of an open PR — a no-PR branch shows an empty state rather than hiding the icon.
  const repoProbe = useMobilePrRepoProbe({
    client,
    ready: client !== null && connState === 'connected',
    worktreeId
  })
  const identity = buildMobilePrSidebarIdentity({ worktreeId, branch })

  const buildDeps = useCallback((): PrSidebarLoadDeps | null => {
    if (!client) {
      return null
    }
    return {
      fetchForBranch: (wt, args) => fetchHostedReviewForBranch(client, wt, args),
      fetchWorktreeLinkedPR: (wt) => fetchWorktreeLinkedPR(client, wt),
      fetchPRForBranch: (wt, args) => fetchPRForBranch(client, wt, args),
      fetchWorkItemDetails: (wt, args) => fetchWorkItemDetails(client, wt, args),
      fetchPRChecks: (wt, args) => fetchPRChecks(client, wt, args)
    }
  }, [client])

  useEffect(() => {
    if (!identity) {
      loadSeqRef.current += 1
      detailsSeqRef.current += 1
      stateIdentityRef.current = null
      setState({ kind: 'hidden' })
      return
    }
    if (stateIdentityRef.current !== null && stateIdentityRef.current !== identity) {
      // Why: data is scoped to branch; a branch switch must not keep rendering the previous PR as "fresh."
      loadSeqRef.current += 1
      detailsSeqRef.current += 1
      stateIdentityRef.current = null
      setState({ kind: 'hidden' })
    }
  }, [identity])

  const load = useCallback(
    async (options?: PrSidebarLoadOptions) => {
      const includeDetails = options?.includeDetails ?? true
      const deps = buildDeps()
      const loadIdentity = identity
      if (!deps || !branch || !loadIdentity) {
        return
      }
      lastLoadIncludedDetailsRef.current = includeDetails
      const seq = loadSeqRef.current + 1
      loadSeqRef.current = seq
      // Don't invalidate in-flight phase 2 here: it's only claimed when this load's own phase 2 starts, so a superseded phase-1 load can't orphan the details fetch.
      const previousIdentity = stateIdentityRef.current
      stateIdentityRef.current = loadIdentity
      // Soft refresh: same-branch ready/none stays visible while checks re-fetch; hard "loading" only on first load or identity wipe.
      const keepVisible =
        previousIdentity === loadIdentity &&
        (stateRef.current.kind === 'ready' ||
          stateRef.current.kind === 'none' ||
          stateRef.current.kind === 'loading')
      if (!keepVisible) {
        setState({ kind: 'loading' })
      }
      // Phase 1: PR + checks (fast); linkedPR read runs in parallel with forBranch so a closed/merged linked PR still resolves.
      const next = await loadPrSidebarData(deps, { worktreeId, branch, headSha })
      if (
        !shouldApplyResult(seq, loadSeqRef.current) ||
        stateIdentityRef.current !== loadIdentity
      ) {
        return
      }
      stateIdentityRef.current = loadIdentity
      if (next.kind === 'error' || next.kind === 'blocked') {
        // `error` is read again on the next new connection; `blocked` is left for the user.
        console.warn('[pr-sidebar] the pull request read for this branch failed', {
          worktreeId,
          branch,
          kind: next.kind,
          message: next.message
        })
      }

      // Preserve prior details across phase 1 (loadPrSidebarData returns details:null) so soft/PR-tab refresh doesn't blank the comment tree.
      const priorDetails =
        next.kind === 'ready' &&
        stateRef.current.kind === 'ready' &&
        stateRef.current.data.details != null &&
        stateRef.current.data.pr.number === next.data.pr.number
          ? stateRef.current.data.details
          : null

      if (next.kind === 'ready' && priorDetails != null) {
        setState({ kind: 'ready', data: { ...next.data, details: priorDetails } })
        if (!includeDetails) {
          return
        }
      } else {
        setState(next)
        if (next.kind !== 'ready' || !includeDetails) {
          return
        }
      }

      // Phase 2: refresh (or first-load) the heavy comments/body payload.
      const detailsSeq = detailsSeqRef.current + 1
      detailsSeqRef.current = detailsSeq
      detailsInFlightRef.current = { seq: detailsSeq, prNumber: next.data.pr.number }
      const fetchedDetails = await loadPrSidebarDetails(deps, worktreeId, next.data.pr.number)
      // Release the claim unless a newer phase-2 superseded it (never clear theirs).
      if (detailsInFlightRef.current?.seq === detailsSeq) {
        detailsInFlightRef.current = null
      }
      // Ownership keyed on detailsSeq (not loadSeq): a chip-only soft refresh bumps loadSeq without detailsSeq and must not discard these details.
      if (
        detailsSeq !== detailsSeqRef.current ||
        stateIdentityRef.current !== loadIdentity ||
        stateRef.current.kind !== 'ready' ||
        stateRef.current.data.pr.number !== next.data.pr.number
      ) {
        return
      }
      // Non-fatal null must not leave details===null (UI treats that as forever-loading).
      const details = resolvePrSidebarDetailsAfterPhase2({
        fetched: fetchedDetails,
        prior: stateRef.current.data.details,
        pr: stateRef.current.data.pr
      })
      setState({ kind: 'ready', data: { ...stateRef.current.data, details } })
    },
    [buildDeps, branch, headSha, identity, worktreeId]
  )

  // Phase-2-only fill-in; uses detailsSeqRef so it can't cancel a concurrent phase-1, and re-fetches non-null placeholders too.
  const ensurePrSidebarDetails = useCallback(async () => {
    const current = stateRef.current
    if (current.kind !== 'ready' || !prSidebarDetailsNeedFetch(current.data.details)) {
      return
    }
    const deps = buildDeps()
    const loadIdentity = identity
    if (!deps || !loadIdentity || stateIdentityRef.current !== loadIdentity) {
      return
    }
    const prNumber = current.data.pr.number
    // Skip if a live phase-2 fetch for this PR already owns the latest details seq (dedupe).
    const inFlight = detailsInFlightRef.current
    if (inFlight && inFlight.prNumber === prNumber && inFlight.seq === detailsSeqRef.current) {
      return
    }
    const detailsSeq = detailsSeqRef.current + 1
    detailsSeqRef.current = detailsSeq
    detailsInFlightRef.current = { seq: detailsSeq, prNumber }
    const fetchedDetails = await loadPrSidebarDetails(deps, worktreeId, prNumber)
    if (detailsInFlightRef.current?.seq === detailsSeq) {
      detailsInFlightRef.current = null
    }
    if (
      detailsSeq !== detailsSeqRef.current ||
      stateIdentityRef.current !== loadIdentity ||
      stateRef.current.kind !== 'ready' ||
      stateRef.current.data.pr.number !== prNumber
    ) {
      return
    }
    const details = resolvePrSidebarDetailsAfterPhase2({
      fetched: fetchedDetails,
      prior: stateRef.current.data.details,
      pr: stateRef.current.data.pr
    })
    setState({
      kind: 'ready',
      data: { ...stateRef.current.data, details }
    })
  }, [buildDeps, identity, worktreeId])

  useMobilePrSidebarReconnectRefetch({
    identity,
    state,
    lastConnectedAt: input.lastConnectedAt,
    reload: () => void load({ includeDetails: lastLoadIncludedDetailsRef.current }),
    refillDetails: () => void ensurePrSidebarDetails()
  })

  // Soft-refresh on same-branch HEAD advance; restart in-flight load so the advance isn't applied with a stale SHA.
  useEffect(() => {
    if (headShaRef.current === headSha) {
      return
    }
    headShaRef.current = headSha
    // Identity just wiped: stateRef still holds stale pre-wipe state, so let the surface's hidden-state effects drive the new load.
    if (stateIdentityRef.current === null) {
      return
    }
    const current = stateRef.current
    if (!shouldSoftRefreshPrSidebarOnHeadChange(current.kind)) {
      return
    }
    void load({
      includeDetails: current.kind === 'ready' && current.data.details != null
    })
  }, [headSha, load])

  const openPRSidebar = useCallback(() => {
    setShowPRSidebar(true)
    // (Re)load on open unless we already have fresh PR data showing.
    if (
      stateIdentityRef.current !== identity ||
      (state.kind !== 'ready' && state.kind !== 'loading')
    ) {
      void load({ includeDetails: true })
    } else if (state.kind === 'ready' && prSidebarDetailsNeedFetch(state.data.details)) {
      // Retries phase-2 placeholders too (failed details load, not only null).
      void ensurePrSidebarDetails()
    }
  }, [identity, state, load, ensurePrSidebarDetails])

  const retry = useCallback(() => {
    void load({ includeDetails: true })
  }, [load])

  return {
    prSidebarState: state,
    prSidebarIsGithubRepo: repoProbe.probe === 'github',
    // False until the probe settles — isGithubRepo=false is meaningless mid-probe, so consumers gate "unavailable" copy on this.
    prSidebarRepoProbeLoaded: repoProbe.probe !== 'pending',
    // The probe itself failed: not an answer, so neither "GitHub" nor "unavailable for this provider".
    prSidebarRepoProbeFailed: repoProbe.probe === 'failed',
    retryPrSidebarRepoProbe: repoProbe.retry,
    // The connection these reads are keyed on, for the sidebar's own sections (the reviewer picker).
    prSidebarLastConnectedAt: input.lastConnectedAt,
    showPRSidebar,
    setShowPRSidebar,
    openPRSidebar,
    retryPRSidebar: retry,
    refetchPRSidebar: load,
    ensurePrSidebarDetails
  }
}

export type MobilePrSidebarController = ReturnType<typeof useMobilePrSidebarController>
