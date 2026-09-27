import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/diff-comment-types'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerSuccess } from '../platform/haptics'
import { formatDiffComments, formatMobileDiffReviewPrompt } from './mobile-diff-comments'
import { clearSentMobileDiffComments, markMobileDiffCommentsSent } from './mobile-diff-comment-edit'
import {
  reviewTerminalCreateRun,
  reviewTerminalListRead,
  reviewTerminalSendRun
} from './mobile-review-terminal-operations'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'
import type { ReviewScreenState, SendSheetState } from './mobile-diff-review-screen-model'
import type { MobileReviewTerminalTab } from './review-terminal-reply-schema'

/** Why the notes did not go when the terminal's leftover input could not be
 *  cleared first (a paste native chat left there, #10228). */
export const STALE_INPUT_NOT_CLEARED = "Not sent: couldn't clear the terminal's unsent input first."

/** The row a sheet send is running from: a listed terminal, or null for a
 *  New Agent Session. */
export type NotesSendTarget = { terminal: string | null }

type SendActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  screenState: ReviewScreenState
  setActionError: Dispatch<SetStateAction<string | null>>
  /** The sheet as last drawn, for a send that fails after it closed. */
  sendSheet: SendSheetState | null
  setSendSheet: Dispatch<SetStateAction<SendSheetState | null>>
  saveCommentsAndReviewState: (
    comments: DiffComment[],
    reviewState: MobileDiffReviewState
  ) => Promise<void>
}

export function useMobileDiffReviewSendActions(input: SendActionsInput) {
  // The seam, not `expo-clipboard`: inside the shell the page's own clipboard needs a secure
  // context, which the iOS custom scheme is not and Android's https is.
  const clipboard = useClipboardWriter()
  const {
    client,
    connState,
    worktreeId,
    screenState,
    setActionError,
    sendSheet,
    setSendSheet,
    saveCommentsAndReviewState
  } = input
  const [notesSending, setNotesSending] = useState<NotesSendTarget | null>(null)
  const sendingRef = useRef(false)
  // Read when a send settles, which can be seconds after the tap: the sheet
  // may have closed, or closed and reopened, since.
  const sheetRef = useRef(sendSheet)
  useEffect(() => {
    sheetRef.current = sendSheet
  }, [sendSheet])

  const copyNotes = useCallback(async () => {
    if (screenState.kind !== 'ready' || screenState.comments.length === 0) {
      return
    }
    // Caught here because the only caller is `void controller.copyNotes()`: the seam rejects when
    // the pasteboard refused, and an uncaught rejection would leave "copied" as the last word.
    try {
      await clipboard.writeText(formatDiffComments(screenState.comments))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to copy the review notes')
      return
    }
    triggerSuccess()
    setActionError('Review notes copied')
  }, [clipboard, screenState, setActionError])

  const clearSentNotes = useCallback(async () => {
    if (screenState.kind !== 'ready') {
      return
    }
    const nextComments = clearSentMobileDiffComments(screenState.comments)
    try {
      await saveCommentsAndReviewState(nextComments, screenState.reviewState)
    } catch {
      // Already rolled back, on the banner and in the log; the only caller
      // is a `void` tap with nowhere to send a rejection.
    }
  }, [saveCommentsAndReviewState, screenState])

  const markNotesSent = useCallback(
    async (comments: readonly DiffComment[]) => {
      if (screenState.kind !== 'ready') {
        return
      }
      const next = markMobileDiffCommentsSent(
        screenState.comments,
        new Set(comments.map((comment) => comment.id)),
        Date.now()
      )
      await saveCommentsAndReviewState(next, screenState.reviewState)
    },
    [saveCommentsAndReviewState, screenState]
  )

  /** Clears a stale input, then types the notes and their Enter. No look at
   *  the screen: the caller has looked, or made the terminal a moment ago. */
  const deliverNotes = useCallback(
    async (liveClient: RpcClient, terminal: string, comments: readonly DiffComment[]) => {
      // Marked by terminal handle, not by surface, so a paste orphaned here by native
      // chat would ride along with these notes (#10228). Diff review carries no device token.
      if (!(await healMobileNativeChatStaleInput({ client: liveClient, terminal, deviceToken: null }))) {
        throw new Error(STALE_INPUT_NOT_CLEARED)
      }
      const response = await reviewTerminalSendRun.request(liveClient, {
        terminal,
        text: formatMobileDiffReviewPrompt(comments),
        enter: true
      })
      let accepted
      accepted = interpretOrThrowRefusalMessage(
        () => reviewTerminalSendRun.interpret(response),
        'Failed to send notes'
      )
      if (!accepted) {
        throw new Error('Terminal input is locked')
      }
      try {
        await markNotesSent(comments)
      } catch (err) {
        // The terminal has the notes; only recording that failed. Not a failed
        // send: the sheet closes rather than offer the same notes again.
        setActionError(
          `Review notes sent, but not marked sent: ${(err instanceof Error && err.message) || 'Failed to save review'}`
        )
        setSendSheet(null)
        return
      }
      triggerSuccess()
      setActionError('Review notes sent')
      setSendSheet(null)
    },
    [markNotesSent, setActionError, setSendSheet]
  )

  /**
   * The notes into a terminal the sheet listed, only with no dialog on its
   * screen: text and an Enter answer a permission prompt or pick from a menu
   * (a subagent's prompt sat for eight hours on 2026-09-27). The look comes
   * before the stale-input heal, as in the chat's send, because the heal is a
   * write too: its Ctrl+U would reach the prompt instead of the input line,
   * using up the marker without clearing the paste
   * (mobile-native-chat-stale-input.ts), and the next send would carry it.
   * Fails open like every other caller: a read that fails lets the notes go.
   */
  const sendPromptToTerminal = useCallback(
    async (terminal: string, comments: readonly DiffComment[], agent?: string | null) => {
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      // The agent the host names for the tab, when it names one. Without it
      // the look applies Claude's input-row rule to any tab, and a Codex menu
      // under a row of output that reads like Claude's input (a bare `❯`, or
      // `❯` and a no-break space, at column 0) would read as no dialog.
      const refusal = await readSendUnderDialogRefusal({ client, terminal, agent })
      if (refusal) {
        throw new Error(refusal)
      }
      await deliverNotes(client, terminal, comments)
    },
    [client, connState, deliverNotes]
  )

  const createTerminalAndSend = useCallback(
    async (comments: readonly DiffComment[]) => {
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      const response = await reviewTerminalCreateRun.request(client, {
        worktree: `id:${worktreeId}`,
        activate: false,
        select: true,
        navigation: 'caller'
      })
      let created
      created = interpretOrThrowRefusalMessage(
        () => reviewTerminalCreateRun.interpret(response),
        'Failed to create terminal'
      )
      // Created a moment ago, so nothing is asking on it yet: no look.
      await deliverNotes(client, created.terminal, comments)
    },
    [client, connState, deliverNotes, worktreeId]
  )

  /**
   * What the sheet's rows run. A row runs from a tap with nowhere for a
   * rejection to go, so a send that fails, a refusal included, is drawn on
   * the sheet (its rows kept for a retry) and logged. One at a time: the look
   * takes up to 2 s, and a second tap meanwhile would type the notes twice.
   */
  const sendFromSheet = useCallback(
    async (target: NotesSendTarget, send: () => Promise<void>) => {
      if (sendingRef.current) {
        return
      }
      sendingRef.current = true
      setNotesSending(target)
      try {
        await send()
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : 'Failed to send notes'
        console.warn(`[review-send] notes not sent to ${target.terminal ?? 'a new agent session'}: ${message}`)
        if (sheetRef.current === null) {
          // Closed while the send ran. Reopening it on the failure drew an
          // error sheet with no terminals in it; the review banner says why.
          setActionError(message)
        } else {
          // A sheet reopened since and still loading keeps the reason for its
          // list, which would otherwise overwrite it.
          setSendSheet((sheet) =>
            sheet === null
              ? null
              : sheet.kind === 'loading'
                ? { kind: 'loading', reason: message }
                : { kind: 'error', message, terminals: sheet.terminals }
          )
        }
      } finally {
        sendingRef.current = false
        setNotesSending(null)
      }
    },
    [setActionError, setSendSheet]
  )

  const sendNotesToTerminal = useCallback(
    (tab: MobileReviewTerminalTab, comments: readonly DiffComment[]) =>
      sendFromSheet({ terminal: tab.terminal }, () => sendPromptToTerminal(tab.terminal, comments, tab.agent)),
    [sendFromSheet, sendPromptToTerminal]
  )

  const sendNotesToNewSession = useCallback(
    (comments: readonly DiffComment[]) =>
      sendFromSheet({ terminal: null }, () => createTerminalAndSend(comments)),
    [createTerminalAndSend, sendFromSheet]
  )

  const openSendSheet = useCallback(async () => {
    if (!client || connState !== 'connected') {
      setActionError('Waiting for desktop...')
      return
    }
    setSendSheet({ kind: 'loading' })
    try {
      const response = await reviewTerminalListRead.request(client, {
        worktree: `id:${worktreeId}`
      })
      let terminals
      terminals = interpretOrThrowRefusalMessage(
        () => reviewTerminalListRead.interpret(response),
        'Unable to load agent sessions'
      )
      // A list that lands after the user closed the sheet leaves it closed,
      // and one a failed send is waiting on shows that send's reason.
      setSendSheet((sheet) =>
        sheet === null
          ? null
          : sheet.kind === 'loading' && sheet.reason
            ? { kind: 'error', message: sheet.reason, terminals }
            : { kind: 'ready', terminals }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load agent sessions'
      setSendSheet((sheet) => (sheet === null ? null : { kind: 'error', message, terminals: [] }))
    }
  }, [client, connState, setActionError, setSendSheet, worktreeId])

  return {
    clearSentNotes,
    copyNotes,
    createTerminalAndSend,
    notesSending,
    openSendSheet,
    sendNotesToNewSession,
    sendNotesToTerminal,
    sendPromptToTerminal
  }
}
