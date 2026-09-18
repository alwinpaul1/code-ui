import type { MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatPlanFeedbackSend } from './use-mobile-native-chat-plan-feedback-send'
import { useNativeChatAcceptedAction } from './use-native-chat-action-outcomes'

/**
 * Rejects a Claude Code plan review with typed feedback in one tap, wired
 * for the controller's `handleNativeChatRespondPermissionWithComment`.
 *
 * TUI lane only. `structured` disables the underlying send and the exposed
 * value is undefined, so the comment sheet's "Send back" button never
 * appears in the structured (native chat) lane — see
 * use-mobile-native-chat-plan-feedback-send.ts for why that lane has no
 * verified way to identify or carry the comment.
 */
export function useMobileNativeChatPlanFeedbackRespond(args: {
  client: RpcClient | null
  enabled: boolean
  structured: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  onSendError: (message: string) => void
  onResponseAccepted: () => void
  onAccepted: () => void
}): ((send: string, comment: string) => Promise<boolean>) | undefined {
  const send = useMobileNativeChatPlanFeedbackSend({
    client: args.client,
    enabled: args.enabled && !args.structured,
    handleRef: args.handleRef,
    deviceTokenRef: args.deviceTokenRef,
    onSendError: args.onSendError,
    onResponseAccepted: args.onResponseAccepted
  })
  const respond = useNativeChatAcceptedAction(send, args.onAccepted)
  return args.structured ? undefined : respond
}
