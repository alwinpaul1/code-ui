// What one `agentSession.send` answer means to a client with no outbox.
//
// The desktop reads the same four dispatch states through
// `disposeStructuredAgentSessionSendResult`; mobile has no queue to move, so it
// needs only two facts: the outcome to report, and whether the operation id it
// sent under is spent.
//
// The id is the whole safety mechanism here. Mobile keys its retained ids by
// message body, so re-sending the same text reuses the id — and one id is one
// delivery: `performSend` answers a second request under a recorded id from the
// ledger and never puts it back on the wire. Releasing the id turns that replay
// into a genuine second delivery, which is why only a settled answer releases it:
//
//   accepted/pending — the send happened. The id is spent; a later identical
//     message is a new message and must carry a new id.
//   rejected — a terminal refusal or rejected submission spends a fresh id. A
//     pending-admission refusal, or any refusal after earlier transport doubt,
//     keeps it because neither proves a retained delivery did not happen. One
//     exception spends it anyway, because the host can never accept the replay
//     and keeping the id would only refuse every later send of the same text:
//     an id the host has expired.
//   unknown — the one answer that KEEPS its id, whether it came from the host or
//     from an ack-loss on the way back. The message may be with the provider, so
//     the retry has to stay a replay. Rotating here is what sent one message to a
//     model five times.

import type { AgentSessionSendResult } from '../../../src/shared/agent-session-wire'
import { agentSessionRefusalOperationState } from '../../../src/shared/agent-session-refusal-retry'
import { agentSessionWriteNoticeEnglish } from '../../../src/shared/agent-session-refusal-notice'
import { structuredAgentSessionRejectionNotice } from '../../../src/shared/structured-agent-session-send-disposition'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { StructuredAgentSessionMutationCallResult } from './mobile-structured-agent-session-rpc'

export type MobileStructuredSendDelivery = {
  outcome: MobileNativeChatSendOutcome
  /** True when a retry is safe under a fresh operation id. */
  operationIdSpent: boolean
  /** Copy for the user, or null when the outcome needs none. */
  error: string | null
}

export function mobileStructuredSendDelivery(
  result: StructuredAgentSessionMutationCallResult<AgentSessionSendResult>,
  retained = false
): MobileStructuredSendDelivery {
  if (result.status === 'unknown') {
    return { outcome: 'unknown', operationIdSpent: false, error: null }
  }
  if (result.status === 'refused') {
    const refusalState = agentSessionRefusalOperationState(result.code)
    if (refusalState === 'unknown') {
      return { outcome: 'unknown', operationIdSpent: false, error: null }
    }
    if (retained && result.code === 'agent_session_operation_expired') {
      // The host refuses this id for good once its day is up, so keeping it would refuse this text
      // forever. The earlier attempt may already be in the chat, so the words say to check first.
      // Upstream names a `sendOutcomeLost` sentence the vendored copy here does not have yet.
      return {
        outcome: 'rejected',
        operationIdSpent: true,
        error: agentSessionWriteNoticeEnglish(['outcomeUnknown'])
      }
    }
    return {
      outcome: 'rejected',
      operationIdSpent: refusalState === 'settled-rejected' && !retained,
      error: result.message
    }
  }
  if (result.status !== 'accepted') {
    return {
      outcome: 'rejected',
      operationIdSpent: !retained,
      error: result.message === 'Request not sent' ? 'Message not sent' : result.message
    }
  }
  const submission = result.value.submission as AgentSessionSendResult['submission'] | undefined
  if (!submission || submission.dispatchState === 'unknown') {
    return { outcome: 'unknown', operationIdSpent: false, error: null }
  }
  if (submission.dispatchState === 'rejected') {
    return {
      outcome: 'rejected',
      operationIdSpent: true,
      error: structuredAgentSessionRejectionNotice(submission.reason)
    }
  }
  if (retained) {
    // A payload match cannot distinguish retrying the ambiguous action from a
    // later identical intent. Wait for the stream to settle and release it.
    return { outcome: 'unknown', operationIdSpent: false, error: null }
  }
  return { outcome: 'accepted', operationIdSpent: true, error: null }
}
