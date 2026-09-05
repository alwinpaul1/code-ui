import { useCallback, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { buildQueuedCancelWrites } from './mobile-native-chat-queue-cancel'
import { sendMobileNativeChatMessageWithOutcome } from './mobile-native-chat-send'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

// Why: Claude Code queues messages sent mid-turn and only lets the user take
// the whole queue back with Up; this replays that on the PTY so one bubble's
// Cancel drops just that entry. Only meaningful while the agent still works.
export function useMobileNativeChatCancelQueued(args: {
  client: RpcClient | null
  connected: boolean
  /** Structured (non-PTY) chats have no TUI queue to edit. */
  structured: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  pending: readonly { id: string; text: string }[]
  draft: string
  removePending: (id: string) => void
}): (id: string) => Promise<boolean> {
  const pendingRef = useRef(args.pending)
  pendingRef.current = args.pending
  const draftRef = useRef(args.draft)
  draftRef.current = args.draft
  const { client, connected, structured, handleRef, deviceTokenRef, removePending } = args
  return useCallback(
    async (id: string): Promise<boolean> => {
      const terminal = handleRef.current
      if (!client || !terminal || !connected || structured) {
        return false
      }
      const queued = pendingRef.current.filter((item) => item.text.length > 0)
      const cancelIndex = queued.findIndex((item) => item.id === id)
      if (cancelIndex === -1 || !acquireMobileNativeChatTerminalWrite(terminal)) {
        return false
      }
      try {
        const writes = buildQueuedCancelWrites({
          queued: queued.map((item) => item.text),
          cancelIndex,
          draft: draftRef.current
        })
        const mobileClient = deviceTokenRef.current
          ? { id: deviceTokenRef.current, type: 'mobile' as const }
          : undefined
        for (const write of writes) {
          const outcome = await sendMobileNativeChatMessageWithOutcome({
            client,
            terminal,
            text: write.text,
            enter: write.enter,
            ...(mobileClient ? { mobileClient } : {})
          })
          if (outcome !== 'accepted') {
            return false
          }
        }
      } finally {
        releaseMobileNativeChatTerminalWrite(terminal)
      }
      removePending(id)
      return true
    },
    [client, connected, deviceTokenRef, handleRef, removePending, structured]
  )
}
