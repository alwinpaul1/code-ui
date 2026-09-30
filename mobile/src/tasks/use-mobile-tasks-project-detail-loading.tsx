import type { ItemDetailLoadingModel } from './use-mobile-tasks-item-detail-loading'
import { useEffect, useRef, useState } from './mobile-tasks-dependencies'
import {
  editableProjectFields,
  projectFieldDraftValue,
  projectRowType,
  splitRepositorySlug
} from './mobile-tasks-legacy-foundation'
import { githubProjectRowDetailRead } from './mobile-task-project-board-operations'
import { useTaskReadAgainAfterReconnect } from './use-task-read-again-after-reconnect'

/**
 * The open board row's detail read. A failed read is read again once per NEW connection of the
 * host (`lastConnectedAt`, from MobileTasksScreen); null, the default, follows no connection.
 *
 * That re-read is the same row, so it keeps the row's drafts: the field editors draw from the
 * board table and stay open under a failed detail, and a connection coming up must not wipe what
 * the user was typing there. A new row, table or host, or the refresh after a review action, seeds
 * them again as it always did.
 */
export function useMobileTasksProjectDetailLoading(
  model: ItemDetailLoadingModel,
  lastConnectedAt: number | null = null
) {
  const {
    activeGitHubProjectHost,
    client,
    githubProjectTable,
    projectRowDetailRefreshSeq,
    projectRowItem,
    setExpandedPrFilePath,
    setPrFileCommentDrafts,
    setPrFileContents,
    setPrFileLoadingPath,
    setProjectBodyDraft,
    setProjectCommentDraft,
    setProjectEditingCommentDraft,
    setProjectEditingCommentId,
    setProjectFieldDrafts,
    setProjectReviewersDraft,
    setProjectRowDetail,
    setProjectRowDetailError,
    setProjectRowDetailLoading,
    setProjectTitleDraft,
    tasksSupported
  } = model
  const [reconnectReads, setReconnectReads] = useState(0)
  // This read's own failure. `projectRowDetailError` is not it: the row's actions write that line
  // too, and clear it when they start, over a detail that loaded or one that never did.
  const [readFailed, setReadFailed] = useState(false)
  const readForRef = useRef<readonly unknown[] | null>(null)
  useEffect(() => {
    const readFor = [
      activeGitHubProjectHost,
      client,
      githubProjectTable,
      projectRowDetailRefreshSeq,
      projectRowItem,
      tasksSupported
    ]
    const previous = readForRef.current
    readForRef.current = readFor
    const sameRowReadAgain =
      previous !== null && readFor.every((value, index) => value === previous[index])
    setReadFailed(false)
    if (!projectRowItem) {
      setProjectRowDetail(null)
      setProjectRowDetailLoading(false)
      setProjectRowDetailError('')
      setProjectTitleDraft('')
      setProjectBodyDraft('')
      setProjectCommentDraft('')
      setProjectEditingCommentId(null)
      setProjectEditingCommentDraft('')
      setProjectReviewersDraft('')
      setExpandedPrFilePath(null)
      setPrFileContents({})
      setPrFileLoadingPath(null)
      setPrFileCommentDrafts({})
      setProjectFieldDrafts({})
      return
    }

    const type = projectRowType(projectRowItem)
    const slug = splitRepositorySlug(projectRowItem.content.repository)
    if (!sameRowReadAgain) {
      setProjectTitleDraft(projectRowItem.content.title)
      setProjectBodyDraft(projectRowItem.content.body ?? '')
      setProjectCommentDraft('')
      setProjectEditingCommentId(null)
      setProjectEditingCommentDraft('')
      setProjectReviewersDraft('')
      setExpandedPrFilePath(null)
      setPrFileContents({})
      setPrFileLoadingPath(null)
      setPrFileCommentDrafts({})
      setProjectFieldDrafts(
        Object.fromEntries(
          editableProjectFields(githubProjectTable).map((field) => [
            field.id,
            projectFieldDraftValue(projectRowItem, field)
          ])
        )
      )
    }
    setProjectRowDetail(null)
    setProjectRowDetailError('')

    if (!tasksSupported || !client || !type || !slug || !projectRowItem.content.number) {
      setProjectRowDetailLoading(false)
      return
    }

    let stale = false
    setProjectRowDetailLoading(true)

    void githubProjectRowDetailRead
      .request(
        client,
        {
          owner: slug.owner,
          repo: slug.repo,
          host: activeGitHubProjectHost,
          number: projectRowItem.content.number,
          type
        },
        { timeoutMs: 30_000 }
      )
      .then((response) => {
        if (stale) {
          return
        }
        const result = githubProjectRowDetailRead.interpret(response)
        if (!result.ok) {
          throw new Error(result.error.message)
        }
        // The five collections are typed by the same entity schemas the item sheet reads them
        // through, so the casts this call site carried are gone. `reviewDecision` is forwarded with
        // no coalesce: explicit null and absent are different answers to "has this been reviewed",
        // and collapsing either is a product change.
        setProjectRowDetail({
          provider: 'github',
          body: result.details.body ?? '',
          comments: result.details.comments ?? [],
          labels: result.details.item?.labels ?? projectRowItem.content.labels.map((l) => l.name),
          assignees: result.details.assignees ?? [],
          reviewDecision: result.details.item?.reviewDecision,
          reviewRequests: result.details.item?.reviewRequests ?? [],
          latestReviews: result.details.item?.latestReviews ?? [],
          headSha: result.details.headSha,
          baseSha: result.details.baseSha,
          pullRequestId: result.details.pullRequestId,
          checks: result.details.checks ?? [],
          files: result.details.files ?? []
        })
      })
      .catch((err) => {
        if (!stale) {
          setProjectRowDetailError(err instanceof Error ? err.message : 'Failed to load details')
          setReadFailed(true)
        }
      })
      .finally(() => {
        if (!stale) {
          setProjectRowDetailLoading(false)
        }
      })

    return () => {
      stale = true
    }
  }, [
    activeGitHubProjectHost,
    client,
    githubProjectTable,
    projectRowDetailRefreshSeq,
    projectRowItem,
    reconnectReads,
    tasksSupported
  ])

  useTaskReadAgainAfterReconnect({
    key: projectRowItem ? projectRowItem.id : null,
    failed: readFailed,
    lastConnectedAt,
    readAgain: () => setReconnectReads((current) => current + 1)
  })
  return model
}

export type ProjectDetailLoadingModel = ReturnType<typeof useMobileTasksProjectDetailLoading>
