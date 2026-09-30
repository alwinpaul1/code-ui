import type { ItemDetailMetadataEffectsModel } from './use-mobile-tasks-item-detail-metadata-effects'
import {
  type HostedReviewDecision,
  buildGitLabCheckSummary,
  useEffect,
  useState
} from './mobile-tasks-dependencies'
import { type TaskItem, createLinearTask } from './mobile-tasks-legacy-foundation'
import { useTaskReadAgainAfterReconnect } from './use-task-read-again-after-reconnect'
import {
  githubItemDetailRead,
  gitlabItemDetailRead,
  linearIssueCommentsRead,
  linearIssueRead
} from './mobile-task-item-detail-operations'

/**
 * The open item's detail read. `lastConnectedAt` is the host's (useLastConnectedAt, handed down by
 * MobileTasksScreen): a failed read is read again once per NEW connection, the way the refresh icon
 * reads it, through useTaskReadAgainAfterReconnect. It defaults to null for a mount that follows no
 * connection, such as the RPC recordings, whose model carries no connection time.
 */
export function useMobileTasksItemDetailLoading(
  model: ItemDetailMetadataEffectsModel,
  lastConnectedAt: number | null = null
) {
  const {
    actionItem,
    client,
    detailPayload,
    detailRefreshSeq,
    setActionItem,
    setDetailError,
    setDetailLoading,
    setDetailPayload,
    setDetailRefreshSeq,
    setItems,
    tasksSupported
  } = model
  // This read's own failure, which the error line cannot stand for: a rejection with an empty
  // message leaves that line '' over a sheet with no detail.
  const [readFailed, setReadFailed] = useState(false)
  useEffect(() => {
    setReadFailed(false)
    if (!tasksSupported || !actionItem || !client) {
      setDetailPayload(null)
      setDetailLoading(false)
      setDetailError('')
      return
    }

    let stale = false
    setDetailPayload(null)
    setDetailError('')
    setDetailLoading(true)

    const loadDetails = async (): Promise<void> => {
      if (actionItem.provider === 'github') {
        const reply = await githubItemDetailRead.request(
          client,
          {
            repo: `id:${actionItem.source.repoId}`,
            number: actionItem.source.number,
            type: actionItem.source.type
          },
          { timeoutMs: 30_000 }
        )
        const details = githubItemDetailRead.interpret(reply)
        if (!details) {
          throw new Error('Details not found')
        }
        if (!stale) {
          setDetailPayload({
            provider: 'github',
            body: details.body ?? '',
            comments: details.comments ?? [],
            labels: details.item?.labels ?? actionItem.source.labels,
            assignees: details.assignees ?? [],
            reviewDecision: details.item?.reviewDecision ?? actionItem.source.reviewDecision,
            reviewRequests: details.item?.reviewRequests ?? actionItem.source.reviewRequests ?? [],
            latestReviews: details.item?.latestReviews ?? actionItem.source.latestReviews ?? [],
            headSha: details.headSha,
            baseSha: details.baseSha,
            pullRequestId: details.pullRequestId,
            checks: details.checks ?? [],
            files: details.files ?? []
          })
        }
        return
      }

      if (actionItem.provider === 'gitlab') {
        const reply = await gitlabItemDetailRead.request(
          client,
          {
            repo: `id:${actionItem.source.repoId}`,
            iid: actionItem.source.number,
            type: actionItem.source.type,
            projectRef: actionItem.source.projectRef
          },
          { timeoutMs: 30_000 }
        )
        const details = gitlabItemDetailRead.interpret(reply)
        if (!details) {
          throw new Error('Details not found')
        }
        if (!stale) {
          setDetailPayload({
            provider: 'gitlab',
            body: details.body ?? '',
            comments: details.comments ?? [],
            labels: details.item?.labels ?? actionItem.source.labels,
            assignees: details.assignees ?? [],
            pipelineJobs: details.pipelineJobs ?? []
          })
          const checksSummary = buildGitLabCheckSummary(details.pipelineJobs ?? [])
          const reviewDecision: Exclude<HostedReviewDecision, null> | undefined =
            details.approvalState?.approvalsRequired && details.approvalState.approvalsLeft === 0
              ? 'approved'
              : details.approvalState?.approvalsLeft && details.approvalState.approvalsLeft > 0
                ? 'review_required'
                : undefined
          const hydratedStatus = {
            ...(details.item?.mergeable !== undefined ? { mergeable: details.item.mergeable } : {}),
            ...(reviewDecision !== undefined ? { reviewDecision } : {}),
            ...(details.reviewers !== undefined ? { reviewerCount: details.reviewers.length } : {})
          }
          setActionItem((current) =>
            current?.provider === 'gitlab' && current.source.id === actionItem.source.id
              ? {
                  ...current,
                  source: {
                    ...current.source,
                    checksSummary,
                    ...hydratedStatus
                  }
                }
              : current
          )
          setItems((current) =>
            current.map((candidate) =>
              candidate.provider === 'gitlab' && candidate.source.id === actionItem.source.id
                ? {
                    ...candidate,
                    source: {
                      ...candidate.source,
                      checksSummary,
                      ...hydratedStatus
                    }
                  }
                : candidate
            )
          )
        }
        return
      }

      // Interpretation is deferred past the group on purpose: this Promise.all rejects as soon as
      // one leg's transport does, and interpreting only after both settled is what makes the issue
      // error win over the comments error. startRpcOperation would wait for the slower peer.
      const [issueReply, commentsReply] = await Promise.all([
        linearIssueRead.request(
          client,
          {
            id: actionItem.source.id,
            workspaceId: actionItem.source.workspaceId
          },
          { timeoutMs: 30_000 }
        ),
        linearIssueCommentsRead.request(
          client,
          {
            issueId: actionItem.source.id,
            workspaceId: actionItem.source.workspaceId
          },
          { timeoutMs: 30_000 }
        )
      ])
      const issue = linearIssueRead.interpret(issueReply)
      const accepted = linearIssueCommentsRead.interpret(commentsReply)
      const comments = accepted.accepted ? (accepted.value ?? []) : []
      if (!issue) {
        throw new Error('Details not found')
      }
      if (!stale) {
        // A refused comment read still shows the issue, but as a list it could not read, not as
        // "No comments." (review, 2026-09-30). The flag is set only then, so a read list keeps the
        // payload it always had.
        if (!accepted.accepted) {
          console.warn('[tasks] the Linear comment list could not be read', {
            issueId: actionItem.source.id,
            ...(commentsReply.ok
              ? { cause: 'no list in the reply' }
              : { code: commentsReply.error.code, cause: commentsReply.error.message })
          })
        }
        setDetailPayload({
          provider: 'linear',
          description: issue.description ?? '',
          comments,
          labels: issue.labels ?? [],
          assignee: issue.assignee?.displayName,
          project: issue.project,
          children: issue.subIssues ?? [],
          ...(accepted.accepted ? {} : { commentsFailed: true as const })
        })
        setActionItem((current) => {
          if (current?.provider !== 'linear' || current.source.id !== issue.id) {
            return current
          }
          const currentChildren = current.source.subIssues ?? []
          const nextChildren = issue.subIssues ?? []
          const alreadyHydrated =
            current.source.project?.id === issue.project?.id &&
            currentChildren.length === nextChildren.length &&
            currentChildren.every((child, index) => child.id === nextChildren[index]?.id)
          return alreadyHydrated
            ? current
            : (createLinearTask(issue) as Extract<TaskItem, { provider: 'linear' }>)
        })
      }
    }

    void loadDetails()
      .catch((err) => {
        if (!stale) {
          setDetailError(err instanceof Error ? err.message : 'Failed to load details')
          setReadFailed(true)
        }
      })
      .finally(() => {
        if (!stale) {
          setDetailLoading(false)
        }
      })

    return () => {
      stale = true
    }
  }, [actionItem, client, detailRefreshSeq, tasksSupported])

  // A Linear comment list the desktop refused is read again with the rest of the detail.
  useTaskReadAgainAfterReconnect({
    key: actionItem ? `${actionItem.provider}:${actionItem.source.id}` : null,
    failed:
      readFailed || (detailPayload?.provider === 'linear' && detailPayload.commentsFailed === true),
    lastConnectedAt,
    readAgain: () => setDetailRefreshSeq((current) => current + 1)
  })
  return model
}

export type ItemDetailLoadingModel = ReturnType<typeof useMobileTasksItemDetailLoading>
