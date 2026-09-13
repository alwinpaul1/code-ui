import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../terminal/terminal-send-request'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import {
  cancelTerminalLivePendingFlush,
  createTerminalLivePendingFlushState,
  queueTerminalLiveMirrorSend,
  waitForTerminalLivePendingFlush
} from '../terminal/terminal-live-pending-flush-state'
import type { RpcClient } from '../transport/rpc-client'
import { planNativeChatDraftMirror } from './mobile-native-chat-draft-mirror'
import { isMobileNativeChatTerminalWriteInFlight } from './mobile-native-chat-terminal-write-lock'

export type MobileNativeChatDraftMirror = {
  /** Drain in-flight echoes and forget the mirrored line. Called by the send
   *  path before its own clear + body, which replaces the line wholesale. */
  settleBeforeSend: () => Promise<void>
}

/**
 * Echo the chat composer draft onto the agent's TUI input line as it is typed,
 * so the desktop shows what the phone is writing before it is sent.
 *
 * Only edits made while the mirror is enabled are echoed: a draft restored from
 * storage is not retyped onto the desktop every time the tab opens. Sends go
 * through the same ordered batch queue as live terminal input, and the mirror
 * stands aside while a composed chat write (image paste, answer) owns the PTY.
 */
export function useMobileNativeChatDraftMirror(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  text: string
  /** The composer's own edit counter; only a keystroke moves it. */
  getComposerEditGeneration: () => number
}): MobileNativeChatDraftMirror {
  const { client, enabled, handleRef, deviceTokenRef, text, getComposerEditGeneration } = args
  const flushStateRef = useRef(createTerminalLivePendingFlushState())
  const sentTextRef = useRef('')
  const mirroredHandleRef = useRef<string | null>(null)
  /** The composer's edit count as of the last enable. Echoing starts only once
   *  the user has actually typed, never merely because `text` changed: a draft
   *  read back from storage (and the host's launch-draft prefill) lands a render
   *  or more AFTER the mirror enables, and comparing text alone read that as a
   *  keystroke and typed the whole restored draft onto the desktop input line
   *  (reported from the phone, 2026-09-13). */
  const baselineEditsRef = useRef<number | null>(null)
  const armedRef = useRef(false)

  const forget = useCallback(() => {
    cancelTerminalLivePendingFlush(flushStateRef.current)
    sentTextRef.current = ''
    mirroredHandleRef.current = null
  }, [])

  const sendPayload = useCallback(
    (handle: string, payload: string): Promise<boolean> => {
      const rpc = client
      if (!rpc || handle !== handleRef.current) {
        return Promise.resolve(false)
      }
      return rpc
        .sendRequest(
          'terminal.send',
          buildTerminalSendParams({
            terminal: handle,
            text: payload,
            enter: false,
            deviceToken: deviceTokenRef.current
          }),
          TERMINAL_INPUT_SEND_OPTIONS
        )
        .then(isTerminalSendRpcAccepted, () => false)
    },
    [client, deviceTokenRef, handleRef]
  )

  useEffect(() => {
    if (!enabled) {
      forget()
      baselineEditsRef.current = null
      armedRef.current = false
      return
    }
    if (baselineEditsRef.current === null) {
      baselineEditsRef.current = getComposerEditGeneration()
      armedRef.current = false
      return
    }
    if (!armedRef.current) {
      if (getComposerEditGeneration() === baselineEditsRef.current) {
        return
      }
      armedRef.current = true
    }
    const handle = handleRef.current
    if (!handle) {
      return
    }
    if (mirroredHandleRef.current !== null && mirroredHandleRef.current !== handle) {
      // The active terminal changed under the draft; the old line is not ours to edit.
      forget()
    }
    if (isMobileNativeChatTerminalWriteInFlight(handle)) {
      return
    }
    const plan = planNativeChatDraftMirror(sentTextRef.current, text)
    if (plan.writes.length === 0) {
      return
    }
    sentTextRef.current = plan.nextSentText
    mirroredHandleRef.current = handle
    for (const payload of plan.writes) {
      void queueTerminalLiveMirrorSend(flushStateRef.current, handle, payload, sendPayload)
    }
  }, [enabled, forget, getComposerEditGeneration, handleRef, sendPayload, text])

  useEffect(() => forget, [forget])

  const settleBeforeSend = useCallback(async () => {
    await waitForTerminalLivePendingFlush(flushStateRef.current)
    forget()
    // The send empties the composer; that clear is an edit, and re-baselining on
    // the count here keeps it from being echoed as one.
    baselineEditsRef.current = null
    armedRef.current = false
  }, [forget])

  return { settleBeforeSend }
}
