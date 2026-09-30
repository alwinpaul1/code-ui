import type { ItemDetailMetadataEffectsModel } from './use-mobile-tasks-item-detail-metadata-effects'
import {
  type HostedReviewDecision,
  buildGitLabCheckSummary,
  useEffect,
  useRef,
  useState
} from './mobile-tasks-dependencies'
import { type DetailComment, type TaskItem, createLinearTask } from './mobile-tasks-legacy-foundation'
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
  // What this sheet posted over a Linear comment list the desktop refused, and the issue it is on.
  // Under `commentsFailed` the payload's list holds only that (the post appends to it, in
  // use-mobile-tasks-linear-item-actions.tsx), and a read of the same issue refused again keeps
  // it: an empty list there hid a comment the desktop holds, and the user posted it again (fix
  // round 1, F12). It is held here, not read back from the payload when a read starts, because
  // every read clears the payload first and one that fails outright or is still in flight leaves
  // it cleared, so the read after it, refused again, dropped the comment (fix round 2,
  // 2026-10-01). A list that is read replaces it, the posted comment included, and another issue
  // opening drops it.
  const postedOverRefusedListRef = useRef<{ issueId: string; comments: DetailComment[] } | null>(
    null
  )
  useEffect(() => {
    setReadFailed(false)
    const held = postedOverRefusedListRef.current
    if (actionItem?.provider !== 'linear' || held?.issueId !== actionItem.source.id) {
      postedOverRefusedListRef.current = null
    } else if (detailPayload?.provider === 'linear' && detailPayload.commentsFailed === true) {
      // The list on screen, with whatever was posted since the last read. No payload (a read
      // that failed or is still in flight) keeps what is held.
      postedOverRefusedListRef.current = {
        issueId: actionItem.source.id,
        comments: detailPayload.comments
      }
    }
    if (!tasksSupported || !actionItem || !client) {
      setDetailPayload(null)
      setDetailLoading(false)
      setDetailError('')
      return
    }

    let stale = false
    const postedOverRefusedList = postedOverRefusedListRef.current?.comments ?? []
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
      const comments = accepted.accepted ? (accepted.value ?? []) : postedOverRefusedList
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
        postedOverRefusedListRef.current = accepted.accepted
          ? null
          : { issueId: actionItem.source.id, comments }
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
