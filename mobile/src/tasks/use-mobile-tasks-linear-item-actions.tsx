import type { GithubReplyMergeActionsModel } from './use-mobile-tasks-github-reply-merge-actions'
import { useCallback, useEffect, useRef } from './mobile-tasks-dependencies'
import {
  type DetailComment,
  type LinearIssueChild,
  type TaskItem,
  createLinearTask
} from './mobile-tasks-legacy-foundation'
import { linearIssueRead } from './mobile-task-item-detail-operations'
import { linearIssueCommentWrite } from './mobile-task-item-comment-operations'
import { linearIssueCreate } from './mobile-task-item-state-operations'

export function useMobileTasksLinearItemActions(model: GithubReplyMergeActionsModel) {
  const {
    actionItem,
    client,
    detailPayload,
    linearCommentDraft,
    linearSubIssueTitle,
    mutatingStatus,
    setActionItem,
    setDetailPayload,
    setDetailRefreshSeq,
    setError,
    setLinearCommentDraft,
    setLinearSubIssueTitle,
    setMutatingStatus
  } = model
  // Which issue the sheet shows, how many times the shown issue has changed, and whether its
  // detail is on screen, for a post's reply to check after its await. The payload names no issue,
  // so a reply that landed after the sheet moved was drawn on the issue opened meanwhile, and
  // cleared the draft typed there (review, 2026-10-01).
  const openIssueId = actionItem?.provider === 'linear' ? actionItem.source.id : null
  const sheetRef = useRef({ issueId: openIssueId, opened: 0, detailShown: detailPayload != null })
  useEffect(() => {
    sheetRef.current = {
      issueId: openIssueId,
      opened: sheetRef.current.opened + (sheetRef.current.issueId === openIssueId ? 0 : 1),
      detailShown: sheetRef.current.detailShown
    }
  }, [openIssueId])
  useEffect(() => {
    sheetRef.current = { ...sheetRef.current, detailShown: detailPayload != null }
  }, [detailPayload])

  /**
   * Where a post's reply may land. Null when another issue, or none, is open: nothing here is
   * that post's. Otherwise `sameSheet` when the sheet never left the issue it was sent from, so
   * the draft is still the one sent; and `append` when, besides, its detail is on screen. Without
   * that the issue is read again: a refresh still in flight, or the read made on coming back to
   * the issue, may answer from before the desktop took the post.
   */
  const replyLanding = useCallback(
    (issueId: string, opened: number): { sameSheet: boolean; append: boolean } | null => {
      const sheet = sheetRef.current
      if (sheet.issueId !== issueId) {
        return null
      }
      const sameSheet = sheet.opened === opened
      const append = sameSheet && sheet.detailShown
      if (!append) {
        setDetailRefreshSeq((current) => current + 1)
      }
      return { sameSheet, append }
    },
    []
  )
  const addLinearComment = useCallback(
    async (item: Extract<TaskItem, { provider: 'linear' }>): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      const body = linearCommentDraft.trim()
      if (!body) {
        return
      }
      setMutatingStatus(true)
      setError('')
      const opened = sheetRef.current.opened
      try {
        const reply = await linearIssueCommentWrite.request(
          client,
          {
            issueId: item.source.id,
            workspaceId: item.source.workspaceId,
            body
          },
          { timeoutMs: 30_000 }
        )
        const result = linearIssueCommentWrite.interpret(reply)
        if (result.ok === false) {
          throw new Error(result.error ?? 'Failed to add comment')
        }
        const comment: DetailComment = {
          id: result.id ?? `local-${Date.now()}`,
          body,
          createdAt: new Date().toISOString(),
          user: { displayName: 'You' }
        }
        const landing = replyLanding(item.source.id, opened)
        if (landing?.sameSheet) {
          setLinearCommentDraft('')
        }
        if (!landing?.append) {
          return
        }
        // A refresh that read the list after the desktop took the post already holds it.
        setDetailPayload((current) =>
          current?.provider === 'linear' && !current.comments.some((entry) => entry.id === comment.id)
            ? { ...current, comments: [...current.comments, comment] }
            : current
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add Linear comment')
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, linearCommentDraft, mutatingStatus, replyLanding]
  )

  const openLinearSubIssue = useCallback(
    async (child: LinearIssueChild, workspaceId?: string): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      setMutatingStatus(true)
      setError('')
      try {
        const reply = await linearIssueRead.request(
          client,
          { id: child.id, workspaceId },
          { timeoutMs: 30_000 }
        )
        const issue = linearIssueRead.interpret(reply)
        if (!issue) {
          throw new Error('Sub-issue not found')
        }
        setActionItem(createLinearTask(issue) as Extract<TaskItem, { provider: 'linear' }>)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Linear sub-issue')
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, mutatingStatus]
  )

  const createLinearSubIssue = useCallback(
    async (item: Extract<TaskItem, { provider: 'linear' }>): Promise<void> => {
      if (!client || mutatingStatus) {
        return
      }
      const title = linearSubIssueTitle.trim()
      if (!title) {
        return
      }
      setMutatingStatus(true)
      setError('')
      const opened = sheetRef.current.opened
      try {
        const reply = await linearIssueCreate.request(
          client,
          {
            teamId: item.source.team.id,
            title,
            workspaceId: item.source.workspaceId,
            parentIssueId: item.source.id,
            projectId: item.source.project?.id ?? null
          },
          { timeoutMs: 30_000 }
        )
        const result = linearIssueCreate.interpret(reply)
        if (result.ok === false || !result.id || !result.identifier) {
          throw new Error(result.error ?? 'Failed to create sub-issue')
        }
        const child: LinearIssueChild = {
          id: result.id,
          identifier: result.identifier,
          title: result.title ?? title,
          url: result.url ?? ''
        }
        const landing = replyLanding(item.source.id, opened)
        if (landing?.sameSheet) {
          setLinearSubIssueTitle('')
        }
        if (!landing?.append) {
          return
        }
        setDetailPayload((current) =>
          current?.provider === 'linear'
            ? {
                ...current,
                children: current.children.some((entry) => entry.id === child.id)
                  ? current.children
                  : [...current.children, child]
              }
            : current
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create Linear sub-issue')
      } finally {
        setMutatingStatus(false)
      }
    },
    [client, linearSubIssueTitle, mutatingStatus, replyLanding]
  )
  return Object.assign(model, { addLinearComment, openLinearSubIssue, createLinearSubIssue })
}

export type LinearItemActionsModel = ReturnType<typeof useMobileTasksLinearItemActions>
