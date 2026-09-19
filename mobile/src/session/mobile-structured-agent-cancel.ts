import type { AgentSessionCancelResult } from '../../../src/shared/agent-session-wire'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId
} from './mobile-structured-agent-session-rpc'
import type { RpcClient } from '../transport/rpc-client'

/** Asks the host to interrupt one open turn, and says what happened in the
 *  composer's own error line. Fire-and-forget on purpose: the caller is a
 *  button press, and the transcript is what proves the stop landed.
 *
 *  An `unknown` outcome keeps the retained operation id, so a retry is admitted
 *  as the same request rather than as a second stop — unless the host itself
 *  answered `agent_session_operation_unknown` about that id (Orca #20133 maps
 *  that to `unknown` for cancel; #20868 tells the two apart). */
export function dispatchStructuredTurnCancel(args: {
  client: RpcClient
  sessionId: string
  /** The runtime fence the caller read; a stale one is refused by the host. */
  fence: number
  turnId: string
  sessionKey: string
  operationIds: Map<string, string>
  onError: (message: string) => void
}): void {
  const { client, sessionId, fence, turnId, sessionKey, operationIds, onError } = args
  const fields = { turnId }
  const key = `${sessionKey}:agentSession.cancel:${JSON.stringify(fields)}`
  const clientOperationId = retainStructuredSessionOperationId(
    operationIds,
    key,
    operationIds.get(key)
  )
  void requestStructuredAgentSessionMutation<AgentSessionCancelResult>({
    client,
    method: 'agentSession.cancel',
    fingerprintMethod: 'agentSession.cancel',
    sessionId,
    expectedRuntimeFence: fence,
    fields,
    clientOperationId
  }).then((result) => {
    // Cancel's plan recovers no unknown ledger row, so an id the host answered that
    // way earns the same refusal until it expires; keeping it leaves Stop unusable.
    // Transport doubt proves nothing about delivery, so it stays a replay.
    if (result.status !== 'unknown' || result.hostReportedOperationUnknown === true) {
      operationIds.delete(key)
    }
    if (result.status === 'unknown') {
      onError('Stop unconfirmed — check chat before retrying')
    } else if (result.status === 'refused') {
      onError(result.message)
    } else if (result.status === 'failed') {
      onError(result.message === 'Request not sent' ? 'Stop not sent' : result.message)
    }
  })
}
