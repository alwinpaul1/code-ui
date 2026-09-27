import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FlatList } from 'react-native'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { triggerSelection } from '../platform/haptics'
import { findNextMobileDiffHunkIndex, findPreviousMobileDiffHunkIndex } from './mobile-diff-hunks'
import type {
  MobileDiffReviewQueueFilter,
  MobileDiffReviewQueueItem
} from './mobile-diff-review-queue'
import type {
  ComposerState,
  ReviewDiffLine,
  ReviewDiffState,
  ReviewScreenState,
  SendSheetState
} from './mobile-diff-review-screen-model'
import { sourceFileDiffOpenRun } from '../source-control/mobile-source-file-open-operations'
import { refusedRpcMessageOrFallback } from '../transport/rpc-refusal-message'
import { useMobileDiffReviewCommentActions } from './use-mobile-diff-review-comment-actions'
import { useMobileDiffReviewGitActions } from './use-mobile-diff-review-git-actions'
import { useMobileDiffReviewSendActions } from './use-mobile-diff-review-send-actions'
import { connectionRetryAction } from '../transport/connection-retry-action'

type InteractionInput = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  screenState: ReviewScreenState
  diffState: ReviewDiffState
  currentItem: MobileDiffReviewQueueItem | null
  queue: MobileDiffReviewQueueItem[]
  filteredQueue: MobileDiffReviewQueueItem[]
  filter: MobileDiffReviewQueueFilter
  currentIndex: number
  activeHunkIndex: number | null
  composer: ComposerState | null
  composerBody: string
  listRef: RefObject<FlatList<ReviewDiffLine> | null>
  setScreenState: Dispatch<SetStateAction<ReviewScreenState>>
  setFilter: Dispatch<SetStateAction<MobileDiffReviewQueueFilter>>
  setCurrentIndex: Dispatch<SetStateAction<number>>
  setActiveHunkIndex: Dispatch<SetStateAction<number | null>>
  setComposer: Dispatch<SetStateAction<ComposerState | null>>
  setComposerBody: Dispatch<SetStateAction<string>>
  setActionError: Dispatch<SetStateAction<string | null>>
  setBusyAction: Dispatch<SetStateAction<string | null>>
  sendSheet: SendSheetState | null
  setSendSheet: Dispatch<SetStateAction<SendSheetState | null>>
  setShowCompletion: Dispatch<SetStateAction<boolean>>
  loadReviewData: () => Promise<void>
  onOpenSession: () => void
  onReconnect: ((hostId: string) => void | Promise<void>) | null
}

export function useMobileDiffReviewInteractions(input: InteractionInput) {
  const {
    client,
    connState,
    hostId,
    worktreeId,
    screenState,
    diffState,
    currentItem,
    queue,
    filteredQueue,
    filter,
    currentIndex,
    activeHunkIndex,
    composer,
    composerBody,
    listRef,
    setScreenState,
    setFilter,
    setCurrentIndex,
    setActiveHunkIndex,
    setComposer,
    setComposerBody,
    setActionError,
    setBusyAction,
    sendSheet,
    setSendSheet,
    setShowCompletion,
    loadReviewData,
    onOpenSession,
    onReconnect
  } = input

  const {
    closeComposer,
    deleteComment,
    markReviewed,
    markUnreviewed,
    openComposer,
    openEditComposer,
    saveCommentsAndReviewState,
    saveComposer
  } = useMobileDiffReviewCommentActions({
    client,
    connState,
    worktreeId,
    screenState,
    currentItem,
    queue,
    filteredQueue,
    filter,
    currentIndex,
    composer,
    composerBody,
    setScreenState,
    setCurrentIndex,
    setComposer,
    setComposerBody,
    setActionError,
    setShowCompletion
  })

  const { runGitMutation, stageReviewedFiles } = useMobileDiffReviewGitActions({
    client,
    connState,
    worktreeId,
    queue,
    setActionError,
    setBusyAction,
    loadReviewData
  })

  const {
    clearSentNotes,
    copyNotes,
    createTerminalAndSend,
    notesSending,
    openSendSheet,
    sendNotesToNewSession,
    sendNotesToTerminal,
    sendPromptToTerminal
  } = useMobileDiffReviewSendActions({
    client,
    connState,
    worktreeId,
    screenState,
    setActionError,
    sendSheet,
    setSendSheet,
    saveCommentsAndReviewState
  })

  return {
    clearSentNotes,
    closeComposer,
    copyNotes,
    createTerminalAndSend,
    deleteComment,
    jumpHunk: (direction: 'next' | 'previous') => {
      if (diffState.kind !== 'ready') {
        return
      }
      const currentLineIndex =
        activeHunkIndex === null ? -1 : (diffState.hunks[activeHunkIndex]?.startIndex ?? -1)
      const nextIndex =
        direction === 'next'
          ? findNextMobileDiffHunkIndex(diffState.hunks, currentLineIndex)
          : findPreviousMobileDiffHunkIndex(diffState.hunks, currentLineIndex)
      const target = nextIndex === null ? null : diffState.hunks[nextIndex]
      if (!target || nextIndex === null) {
        return
      }
      setActiveHunkIndex(nextIndex)
      listRef.current?.scrollToIndex({
        index: target.startIndex,
        animated: true,
        viewPosition: 0.16
      })
      triggerSelection()
    },
    markReviewed,
    markUnreviewed,
    moveFile: (direction: 'next' | 'previous') => {
      if (filteredQueue.length === 0) {
        return
      }
      setCurrentIndex((index) =>
        direction === 'next'
          ? index + 1 >= filteredQueue.length
            ? 0
            : index + 1
          : index - 1 < 0
            ? filteredQueue.length - 1
            : index - 1
      )
    },
    notesSending,
    openComposer,
    openEditComposer,
    openInSession: async () => {
      if (!client || !currentItem || currentItem.scope === 'branch') {
        return
      }
      const filePath = currentItem.filePath
      let response
      try {
        response = await sourceFileDiffOpenRun.request(client, {
          worktree: `id:${worktreeId}`,
          relativePath: filePath,
          staged: currentItem.scope === 'staged'
        })
      } catch (error) {
        // A send the link lost. It was awaited outside any catch and rejected
        // into the tap, leaving nothing on screen. No main behaviour to keep
        // here, and an empty message would draw no banner, so it falls back.
        const why = (error instanceof Error && error.message) || 'Unable to open in session'
        console.warn(`[review-open] ${filePath} not opened: ${why}`)
        setActionError(why)
        return
      }
      try {
        sourceFileDiffOpenRun.interpret(response)
      } catch (error) {
        const why = refusedRpcMessageOrFallback(error, 'Unable to open in session')
        console.warn(`[review-open] ${filePath} not opened: ${why}`)
        setActionError(why)
        return
      }
      onOpenSession()
    },
    openSendSheet,
    retryAction: connectionRetryAction({
      hostId,
      needsReconnect: connState !== 'connected',
      forceReconnect: onReconnect,
      reload: () => void loadReviewData()
    }),
    runGitMutation,
    saveComposer,
    selectFilter: (nextFilter: MobileDiffReviewQueueFilter) => {
      setFilter(nextFilter)
      setCurrentIndex(0)
    },
    sendNotesToNewSession,
    sendNotesToTerminal,
    sendPromptToTerminal,
    stageReviewedFiles
  }
}
