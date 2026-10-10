import type { AgentSessionCancelResult } from '../../../src/shared/agent-session-wire'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import { activeStructuredAgentSessionTurnId } from '../../../src/shared/structured-agent-session-live-turn'
import type { RpcClient } from '../transport/rpc-client'
import {
  requestStructuredAgentSessionMutation,
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
  promptCancelSupported: boolean | null
  prompt?: PromptIdentity
  /** Whether the host answers a repeated Stop of a turn quietly (`agent-session.repeated-stop.v1`,
   *  a 1.4.220 host); null until the status probe answers. */
  hostAnswersRepeatedStops: boolean | null
  /** Stops still on their way, by what they stop; against a host that does not answer a repeat
   *  quietly, a press for the same one joins it here. */
  inFlight: Map<string, Promise<boolean>>
  onSendError: (message: string) => void
}): Promise<boolean> {
  const { client, enabled, inFlight, onSendError, sessionId, stateRef } = args
  const current = stateRef.current
  const turnId = activeStructuredAgentSessionTurnId(current.items)
  if (!client || !sessionId || !enabled || current.fence === null || !turnId) {
    onSendError('Stop not sent')
    return false
  }
  // Check the capability before fields enter the fingerprint.
  const fields = {
    turnId,
    ...(args.prompt && args.promptCancelSupported === true ? { prompt: args.prompt } : {})
  }
  // Orca #24301: every press is its own Stop. A kept id is answered from the last press, so after
  // a Stop whose answer was lost, the next press stopped nothing. Read the fence at the press.
  const fence = current.fence
  const stop = () => sendStop({ client, sessionId, fence, fields, onSendError })
  if (args.hostAnswersRepeatedStops === true) {
    // The host joins a second Stop of a turn it is still stopping, and one that stopped nothing
    // writes no row, so a press while an earlier Stop is stuck is a Stop of its own.
    return stop()
  }
  // Against a host older than that (or before the probe answers), a second Stop runs again and
  // writes a false "already finished" row, so a press while an earlier Stop of the same thing is
  // still on its way joins it: a double tap is one request. Upstream calls this temporary, until
  // no supported host lacks the capability.
  const key = `${sessionId}:agentSession.cancel:${JSON.stringify(fields)}`
  const joined = inFlight.get(key)
  if (joined) {
    return joined
  }
  const stopping = stop()
  inFlight.set(key, stopping)
  // Gone once it settles, so the next press is a new Stop.
  void stopping.finally(() => {
    if (inFlight.get(key) === stopping) {
      inFlight.delete(key)
    }
  })
  return stopping
}

async function sendStop(input: {
  client: RpcClient
  sessionId: string
  fence: number
  fields: Record<string, unknown>
  onSendError: (message: string) => void
}): Promise<boolean> {
  const result: StructuredAgentSessionMutationCallResult<AgentSessionCancelResult> =
    await requestStructuredAgentSessionMutation<AgentSessionCancelResult>({
      client: input.client,
      method: 'agentSession.cancel',
      fingerprintMethod: 'agentSession.cancel',
      sessionId: input.sessionId,
      expectedRuntimeFence: input.fence,
      fields: input.fields
    })
  if (result.status === 'accepted') {
    return true
  }
  if (result.status === 'unknown') {
    input.onSendError('Stop unconfirmed — check chat before retrying')
  } else if (result.status === 'refused') {
    input.onSendError(result.message)
  } else if (result.status === 'failed') {
    input.onSendError(result.message === 'Request not sent' ? 'Stop not sent' : result.message)
  }
  return false
}

/** Stops one background task, resolving true only on the host's `cancelled: true`: the
 *  tasks sheet holds that row's Stop until the row leaves (Orca #26780). An unknown
 *  outcome is said here or nowhere (2026-09-25). A host refusal is said by the shared mutation,
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
  const result = await args.mutate<AgentSessionCancelResult>(
    'agentSession.cancel',
    'agentSession.cancel',
    { turnId: 'background-tasks', scope: 'background-tasks', taskId: args.taskId },
    { onError: args.onSendError }
  )
  if (result.status === 'unknown') {
    args.onSendError('Stop unconfirmed — check chat before retrying')
  }
  // Confirmed only when the host says it stopped the task: an accepted answer with nothing
  // stopped leaves the row's Stop pressable again (Orca #26780's hold).
  return result.status === 'accepted' && result.value.cancelled === true
}
