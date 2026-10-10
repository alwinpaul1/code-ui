// What one `agentSession.send` answer means to a client with no outbox.
//
// The desktop reads the same four dispatch states through
// `disposeStructuredAgentSessionSendResult`; mobile has no queue to move, so it
// needs only the outcome to report and the words, if any, to say.
//
// Every phone Send goes out under its own operation id (Orca #26392), so an answer
// is always about the press that asked. Nothing here decides whether an id is kept
// for a retry any more: a later press is a new action.
//
//   accepted/pending — the send happened.
//   rejected — a refusal or a rejected submission; the words go back to the composer.
//   unknown — the host answered unknown, or the answer was lost on the way back. The
//     message may be with the provider, so the chat holds it as unconfirmed
//     (mobile-native-chat-unconfirmed-hold.ts) rather than handing it back.

import type { AgentSessionSendResult } from '../../../src/shared/agent-session-wire'
import { agentSessionRefusalOperationState } from '../../../src/shared/agent-session-refusal-retry'
import { structuredAgentSessionRejectionNotice } from '../../../src/shared/structured-agent-session-send-disposition'
import {
  readWholeAgentSessionFailureFact,
  type AgentSessionFailureFact
} from '../../../src/shared/agent-session-failure'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { StructuredAgentSessionMutationCallResult } from './mobile-structured-agent-session-rpc'

export type MobileStructuredSendDelivery = {
  outcome: MobileNativeChatSendOutcome
  /** Copy for the user, or null when the outcome needs none. */
  error: string | null
  /** A sign-in rejection's typed cause (Orca #26544): its guidance steps aside once the
   *  transcript states the same failure, so the person reads it once. */
  failure?: AgentSessionFailureFact
}

export function mobileStructuredSendDelivery(
  result: StructuredAgentSessionMutationCallResult<AgentSessionSendResult>
): MobileStructuredSendDelivery {
  if (result.status === 'unknown') {
    return { outcome: 'unknown', error: null }
  }
  if (result.status === 'refused') {
    return agentSessionRefusalOperationState(result.code) === 'unknown'
      ? { outcome: 'unknown', error: null }
      : { outcome: 'rejected', error: result.message }
  }
  if (result.status !== 'accepted') {
    return {
      outcome: 'rejected',
      error: result.message === 'Request not sent' ? 'Message not sent' : result.message
    }
  }
  const submission = result.value.submission as AgentSessionSendResult['submission'] | undefined
  if (!submission || submission.dispatchState === 'unknown') {
    return { outcome: 'unknown', error: null }
  }
  if (submission.dispatchState === 'rejected') {
    const failure = readWholeAgentSessionFailureFact(submission.rejection)
    return {
      outcome: 'rejected',
      error: structuredAgentSessionRejectionNotice(submission.reason),
      ...(failure?.kind === 'notSignedIn' ? { failure } : {})
    }
  }
  return { outcome: 'accepted', error: null }
}
