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
 *  as the same request rather than as a second stop. */
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
    if (result.status !== 'unknown') {
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
