import { useCallback, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { sendClaudePlanFeedback } from './claude-plan-feedback-send'
import { mobileNativeChatSendRefusal } from './mobile-native-chat-send-readiness'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

/**
 * Rejects a Claude Code plan review with the user's typed feedback, TUI lane
 * only. The structured (native chat) lane's `agentSession.respondToApproval`
 * takes an `optionId` with no carried text, and its journal approval item
 * (AgentJournalApprovalItem in src/shared/agent-session-journal-types.ts) has
 * no field naming which option means "reject with feedback" — only a label
 * string this file has no live structured-session capture to verify. Rather
 * than guess that its wording matches the TUI's verified "Tell Claude what to
 * change", this hook is simply not wired for that lane: callers pass
 * `enabled: false` there, and the comment sheet's button never appears.
 */
export function useMobileNativeChatPlanFeedbackSend(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  onSendError: (message: string) => void
  onResponseAccepted?: () => void
}): (send: string, comment: string) => Promise<boolean> {
  return useCallback(
    async (send: string, comment: string): Promise<boolean> => {
      const terminal = args.handleRef.current
      // Refused at once, never held for a relay re-dial: the feedback is typed
      // into a review row the phone has not seen since the link dropped.
      if (!args.client || !terminal || !args.enabled) {
        args.onSendError(
          terminal
            ? mobileNativeChatSendRefusal('Response', { client: args.client, sendable: args.enabled })
            : 'Response not sent (no terminal on this tab)'
        )
        return false
      }
      if (!acquireMobileNativeChatTerminalWrite(terminal)) {
        args.onSendError('Response not sent')
        return false
      }
      let outcome: Awaited<ReturnType<typeof sendClaudePlanFeedback>>
      try {
        outcome = await sendClaudePlanFeedback({
          client: args.client,
          terminal,
          deviceToken: args.deviceTokenRef.current,
          optionSend: send,
          comment
        })
      } finally {
        releaseMobileNativeChatTerminalWrite(terminal)
      }
      if (outcome.kind === 'refused') {
        args.onSendError(outcome.message)
        return false
      }
      if (outcome.kind === 'failed') {
        args.onSendError('Response not sent')
        return false
      }
      args.onResponseAccepted?.()
      return true
    },
    [
      args.client,
      args.deviceTokenRef,
      args.enabled,
      args.handleRef,
      args.onResponseAccepted,
      args.onSendError
    ]
  )
}
