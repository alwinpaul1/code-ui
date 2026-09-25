import type { AgentSessionCancelResult } from '../../../src/shared/agent-session-wire'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import { activeStructuredAgentSessionTurnId } from '../../../src/shared/structured-agent-session-live-turn'
import type { RpcClient } from '../transport/rpc-client'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId,
  type StructuredAgentSessionMutate,
  type StructuredAgentSessionMutationCallResult
} from './mobile-structured-agent-session-rpc'

type PromptIdentity = { itemId: string; expectedRevision: number }

export function pendingStructuredPromptIdentity(
  items: readonly AgentJournalRenderItem[]
): PromptIdentity | undefined {
  const prompt = items.find((item) =>
    item.body.kind === 'approval' || item.body.kind === 'question'
      ? item.body.resolution.state === 'pending'
      : false
  )
  return prompt ? { itemId: prompt.itemId, expectedRevision: prompt.revision } : undefined
}

export async function requestMobileStructuredAgentSessionCancel(args: {
  client: RpcClient | null
  sessionId: string | null
  enabled: boolean
  stateRef: { readonly current: StructuredAgentSessionState }
  sessionKey: string
  operationIds: Map<string, string>
  promptCancelSupported: boolean | null
  prompt?: PromptIdentity
  onSendError: (message: string) => void
}): Promise<boolean> {
  const { client, enabled, onSendError, operationIds, sessionId, sessionKey, stateRef } = args
  const current = stateRef.current
  const turnId = activeStructuredAgentSessionTurnId(current.items)
  if (!client || !sessionId || !enabled || current.fence === null || !turnId) {
    onSendError('Stop not sent')
    return false
  }
  // Check the capability before fields enter either the fingerprint or operation key.
  const fields = {
    turnId,
    ...(args.prompt && args.promptCancelSupported === true ? { prompt: args.prompt } : {})
  }
  const key = `${sessionKey}:agentSession.cancel:${JSON.stringify(fields)}`
  const clientOperationId = retainStructuredSessionOperationId(
    operationIds,
    key,
    operationIds.get(key)
  )
  const result: StructuredAgentSessionMutationCallResult<AgentSessionCancelResult> =
    await requestStructuredAgentSessionMutation<AgentSessionCancelResult>({
      client,
      method: 'agentSession.cancel',
      fingerprintMethod: 'agentSession.cancel',
      sessionId,
      expectedRuntimeFence: current.fence,
      fields,
      clientOperationId
    })
  // Cancel's plan recovers no unknown ledger row, so an id the host answered that
  // way earns the same refusal until it expires; keeping it leaves Stop unusable.
  // Transport doubt proves nothing about delivery, so it stays a replay.
  if (result.status !== 'unknown' || result.hostReportedOperationUnknown === true) {
    operationIds.delete(key)
  }
  if (result.status === 'accepted') {
    return true
  }
  if (result.status === 'unknown') {
    onSendError('Stop unconfirmed — check chat before retrying')
  } else if (result.status === 'refused') {
    onSendError(result.message)
  } else if (result.status === 'failed') {
    onSendError(result.message === 'Request not sent' ? 'Stop not sent' : result.message)
  }
  return false
}

/** Stops one background task. The tasks sheet voids the result and the row keeps
 *  its Stop until the host reports the task ended, so an unknown outcome is said
 *  here or nowhere (2026-09-25). A host refusal is said by the shared mutation,
 *  through the same `onSendError`: the sheet's own reporter when it brought one,
 *  because the chat's banner draws under the sheet. The mutation's not-ready
 *  exit (no client, session or fence) says nothing, but the sheet is drawn from
 *  that same loaded session. */
export async function requestMobileStructuredBackgroundTaskStop(args: {
  mutate: StructuredAgentSessionMutate
  taskId: string
  onSendError: (message: string) => void
}): Promise<boolean> {
  // The host reads `turnId: 'background-tasks'` as the scope marker, not as
  // a real turn — a background task outlives the turn that launched it.
  const result = await args.mutate(
    'agentSession.cancel',
    'agentSession.cancel',
    { turnId: 'background-tasks', scope: 'background-tasks', taskId: args.taskId },
    { onError: args.onSendError }
  )
  if (result.status === 'unknown') {
    args.onSendError('Stop unconfirmed — check chat before retrying')
  }
  return result.status === 'accepted'
}
