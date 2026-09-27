import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
    setSendSheet,
    saveCommentsAndReviewState
  } = input
  const [notesSending, setNotesSending] = useState<NotesSendTarget | null>(null)
  const sendingRef = useRef(false)

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
    await saveCommentsAndReviewState(nextComments, screenState.reviewState)
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
          `Review notes sent, but not marked sent: ${err instanceof Error ? err.message : 'Failed to save review'}`
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
    async (terminal: string, comments: readonly DiffComment[]) => {
      if (!client || connState !== 'connected') {
        throw new Error('Waiting for desktop...')
      }
      // The listed tabs carry no agent, so the look runs without one. Claude's
      // input-row rule then applies to a Codex tab too, which misses a Codex
      // prompt only when a row on screen reads like Claude's input (a bare `❯`,
      // or `❯` and a no-break space, at column 0).
      const refusal = await readSendUnderDialogRefusal({ client, terminal })
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
        setSendSheet((sheet) => ({
          kind: 'error',
          message,
          terminals: sheet && sheet.kind !== 'loading' ? sheet.terminals : []
        }))
      } finally {
        sendingRef.current = false
        setNotesSending(null)
      }
    },
    [setSendSheet]
  )

  const sendNotesToTerminal = useCallback(
    (terminal: string, comments: readonly DiffComment[]) =>
      sendFromSheet({ terminal }, () => sendPromptToTerminal(terminal, comments)),
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
      setSendSheet({ kind: 'ready', terminals })
    } catch (err) {
      setSendSheet({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to load agent sessions',
        terminals: []
      })
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
