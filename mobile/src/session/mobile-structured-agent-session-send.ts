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
  /** An outbox entry's id for this message, the same on each of its attempts; absent, a new
   *  one is minted for this call. */
  operationId?: string
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
  // later Send can put a second copy in front of it. An AUTOMATIC retry of one press is not a
  // new action: the outbox hands every attempt of the press its one stored id
  // (native-chat-outbox-sends.ts), so the ledger answers a retry instead of posting it twice.
  const result = await requestStructuredAgentSessionMutation<AgentSessionSendResult>({
    client: input.client,
    method: 'agentSession.send',
    fingerprintMethod: 'agentSession.send',
    sessionId: input.sessionId,
    expectedRuntimeFence: input.expectedRuntimeFence,
    fields: { body: structuredAgentSessionSendBody(input.text, input.attachments) },
    ...(input.operationId !== undefined ? { clientOperationId: input.operationId } : {}),
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
