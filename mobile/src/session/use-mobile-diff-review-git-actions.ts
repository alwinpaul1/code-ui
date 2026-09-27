import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import {
  MOBILE_DIFF_REVIEW_GIT_MUTATIONS,
  reviewGitStageRun
} from './mobile-diff-review-git-operations'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { MobileDiffReviewQueueItem } from './mobile-diff-review-queue'
import type { GitMutationMethod } from './mobile-diff-review-screen-model'
import { mobileReviewCountLabel } from './mobile-diff-review-screen-model'

type GitActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  queue: MobileDiffReviewQueueItem[]
  setActionError: Dispatch<SetStateAction<string | null>>
  setBusyAction: Dispatch<SetStateAction<string | null>>
  loadReviewData: () => Promise<void>
}

export function useMobileDiffReviewGitActions(input: GitActionsInput) {
  const { client, connState, worktreeId, queue, setActionError, setBusyAction, loadReviewData } =
    input

  const runGitMutation = useCallback(
    async (method: GitMutationMethod, item: MobileDiffReviewQueueItem) => {
      if (!client || connState !== 'connected') {
        setActionError('Waiting for desktop...')
        return
      }
      setBusyAction(`${method}:${item.filePath}`)
      setActionError(null)
      try {
        const mutation = MOBILE_DIFF_REVIEW_GIT_MUTATIONS[method]
        const response = await mutation.request(client, {
          worktree: `id:${worktreeId}`,
          filePath: item.filePath
        })
        interpretOrThrowRefusalMessage(
          () => mutation.interpret(response),
          'Source control action failed'
        )
        triggerSuccess()
        await loadReviewData()
      } catch (err) {
        triggerError()
        setActionError(err instanceof Error ? err.message : 'Source control action failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, connState, loadReviewData, setActionError, setBusyAction, worktreeId]
  )

  const stageReviewedFiles = useCallback(async () => {
    if (!client || connState !== 'connected') {
      setActionError('Waiting for desktop...')
      return
    }
    const files = queue.filter(
      (item) => item.scope === 'unstaged' && item.isReviewed && item.canStage
    )
    if (files.length === 0) {
      return
    }
    setBusyAction('stage-reviewed')
    setActionError(null)
    let staged = 0
    let failed = 0
    // A refusal counts as failed in the loop; a send the link lost throws, and
    // ends the run. That used to skip the busy mark's reset and say nothing,
    // leaving every Stage, Unstage and Discard button disabled. An empty
    // message falls back: this catch has no main behaviour to keep, and an
    // empty banner draws nothing.
    let lost: { why: string } | null = null
    try {
      for (const item of files) {
        const response = reviewGitStageRun.interpret(
          await reviewGitStageRun.request(client, {
            worktree: `id:${worktreeId}`,
            filePath: item.filePath
          })
        )
        if (response.accepted) {
          staged += 1
        } else {
          failed += 1
        }
      }
    } catch (err) {
      lost = { why: (err instanceof Error && err.message) || "Couldn't stage the reviewed files" }
    } finally {
      setBusyAction(null)
    }
    if (lost) {
      console.warn(
        `[review-git] stage reviewed files stopped after ${staged + failed} of ${files.length} (${staged} staged, ${failed} refused): ${lost.why}`
      )
      triggerError()
    } else {
      triggerSuccess()
    }
    // After any loss too: a lost send is delivery-unknown, and may have
    // staged. The reload clears the banner, so the banner is set after it;
    // the success count used to be set first and wiped as it was drawn.
    await loadReviewData()
    if (lost) {
      const counted = [staged > 0 ? `${staged} staged` : null, failed > 0 ? `${failed} refused` : null].filter(
        (part) => part !== null
      )
      setActionError(counted.length > 0 ? `${counted.join(', ')}, then: ${lost.why}` : lost.why)
      return
    }
    setActionError(
      failed > 0
        ? `${staged} staged, ${failed} failed`
        : `${mobileReviewCountLabel(staged, 'reviewed file', 'reviewed files')} staged`
    )
  }, [client, connState, loadReviewData, queue, setActionError, setBusyAction, worktreeId])

  return { runGitMutation, stageReviewedFiles }
}
