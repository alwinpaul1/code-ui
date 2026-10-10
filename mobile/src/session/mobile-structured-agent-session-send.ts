import type { AgentSessionSendResult } from '../../../src/shared/agent-session-wire'
import {
  structuredAgentSessionSendBody,
  type StructuredAgentSessionAttachment
} from '../../../src/shared/structured-agent-session-outbox'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { spentSendBudgetRefusal } from './mobile-native-chat-send-budget-refusal'
import {
  requestStructuredAgentSessionMutation,
  timeoutForDeadline
} from './mobile-structured-agent-session-rpc'
import { mobileStructuredSendDelivery } from './mobile-structured-send-delivery'
import type { MobileNativeChatSendErrorReporter } from './use-mobile-native-chat-send-error'

export async function sendMobileStructuredAgentSessionMessage(input: {
  client: RpcClient
  sessionId: string
  expectedRuntimeFence: number
  text: string
  attachments: readonly StructuredAgentSessionAttachment[]
  deadline?: number
  onError: MobileNativeChatSendErrorReporter
}): Promise<MobileNativeChatSendOutcome> {
  const timeoutMs = timeoutForDeadline(input.deadline)
  if (timeoutMs === null) {
    // Only a deadline is ever spent. Say why: the app was away, or the desktop slow.
    input.onError((input.deadline !== undefined && spentSendBudgetRefusal('Message', input.deadline)) || 'Message not sent')
    return 'rejected'
  }
  // Each Send is a new action (Orca #26392): the shared mutation sender mints its operation id
  // per press. A later press of the same words is a new message, so an earlier attempt the host
  // still holds as unknown can no longer answer for it ("Delivery unconfirmed" on every retry).
  // The trade, as upstream states it: if that earlier attempt did reach the agent, a deliberate
  // later Send can put a second copy in front of it.
  const result = await requestStructuredAgentSessionMutation<AgentSessionSendResult>({
    client: input.client,
    method: 'agentSession.send',
    fingerprintMethod: 'agentSession.send',
    sessionId: input.sessionId,
    expectedRuntimeFence: input.expectedRuntimeFence,
    fields: { body: structuredAgentSessionSendBody(input.text, input.attachments) },
    timeoutMs
  })
  const delivery = mobileStructuredSendDelivery(result)
  if (delivery.error !== null) {
    if (delivery.failure) {
      input.onError(delivery.error, { failure: delivery.failure })
    } else {
      input.onError(delivery.error)
    }
  }
  return delivery.outcome
}
