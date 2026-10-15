import { useEffect, useMemo, useRef } from 'react'
import { useMobileHostedReviewEligibility } from '../source-control/use-mobile-hosted-review-eligibility'
import { agentWorksInWorktree } from './agent-works-in-worktree'
import { worktreePathFromId } from './mobile-native-chat-skill-browse'
import { buildSessionPills, type SessionPill } from './session-pill-row-model'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useMobilePrSidebarController } from './use-mobile-pr-sidebar-controller'
import { useSessionBranchStatus } from './use-session-branch-status'

/**
 * The session pills for this screen, from three reads Orca already answers for the source-control
 * screen: git.status (the branch and commit, and whether there is a remote branch), the pull
 * request read for that branch (the PR and its checks, never its comments), and the host's
 * review-creation eligibility, asked only for a branch the PR read said has no PR.
 *
 * Nothing is read where no pill can show: a repo with no hosted-review remote, a folder or
 * floating workspace, a terminal or file tab (the pills live in the chat), a session whose
 * transcript says it works in another directory than the worktree (agent-works-in-worktree.ts),
 * and before git.status has named a branch. The pull request is read again when the agent finishes a turn, the moment
 * it may have pushed or opened one; a read that failed is read again on the next connection by
 * the PR controller itself.
 *
 * `hasUncommittedChanges` is sent false on purpose. The pills sort a branch by where it lives, on
 * the remote or only here; whether the agent has files open in the work tree is not that, and a
 * "dirty" answer would hide the Local changes pill during exactly the work it names.
 */
export function useSessionPills(controller: MobileSessionController): SessionPill[] {
  const {
    client,
    connState,
    hostId,
    worktreeId,
    lastConnectedAt,
    isFolderWorkspaceRoute,
    isFloatingWorkspaceRoute,
    prIsGithubRepo,
    prRepoContextLoaded
  } = controller
  const { showNativeChat, nativeChatAgentWorking, nativeChatSessionIdentity } = controller.nativeChatController
  // A session working in another checkout than the tab's worktree: every read below is about the
  // worktree, so its PR or "Create PR" would be another branch's. No pill rather than a wrong one.
  const elsewhere =
    agentWorksInWorktree(nativeChatSessionIdentity?.transcriptPath, worktreePathFromId(worktreeId)) === 'elsewhere'
  const hosted =
    !isFolderWorkspaceRoute && !isFloatingWorkspaceRoute && prRepoContextLoaded && prIsGithubRepo && !elsewhere

  const { status, turnsEnded } = useSessionBranchStatus({
    client,
    connState,
    hostId,
    worktreeId,
    agentWorking: nativeChatAgentWorking,
    enabled: hosted && showNativeChat
  })
  const branch = status?.branch ?? null

  const { prSidebarState, refetchPRSidebar } = useMobilePrSidebarController({
    // No client, no reads: the controller probes and loads only with one.
    client: hosted ? client : null,
    connState,
    worktreeId,
    branch,
    headSha: status?.head ?? null,
    lastConnectedAt
  })
  const refetchRef = useRef(refetchPRSidebar)
  refetchRef.current = refetchPRSidebar
  const prKind = prSidebarState.kind

  // Nothing loaded for this branch yet: the first read, and the one after a branch switch wipes it.
  useEffect(() => {
    if (hosted && branch && prKind === 'hidden') {
      void refetchRef.current({ includeDetails: false })
    }
  }, [hosted, branch, prKind])

  // A turn ended: a push or a `gh pr create` may have landed. One soft read per turn end, and the
  // PR it shows stays on screen while the read is out.
  const seenTurnsEnded = useRef(turnsEnded)
  useEffect(() => {
    if (seenTurnsEnded.current === turnsEnded) {
      return
    }
    seenTurnsEnded.current = turnsEnded
    if (hosted && branch && prKind !== 'hidden') {
      void refetchRef.current({ includeDetails: false })
    }
  }, [turnsEnded, hosted, branch, prKind])

  const eligibility = useMobileHostedReviewEligibility({
    client,
    connState,
    hostId,
    worktreeId,
    // Asked only once the PR read says there is none; with a PR it is not asked at all.
    branch: hosted && branch && prKind === 'none' ? branch : undefined,
    hasUpstream: status?.hasUpstream,
    ahead: status?.ahead,
    behind: status?.behind,
    hasUncommittedChanges: false
  })

  return useMemo(
    () => buildSessionPills({ hosted, branch, pr: prSidebarState, eligibility }),
    [hosted, branch, prSidebarState, eligibility]
  )
}
