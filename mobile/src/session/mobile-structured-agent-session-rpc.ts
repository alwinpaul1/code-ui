import {
  AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS,
  AGENT_SESSION_OPERATION_FUTURE_SKEW_MS,
  parseAgentSessionOperationTimestamp
} from '../../../src/shared/agent-session-host-authority'
import type {
  AgentSessionMutationResult,
  AgentSessionWireRefusal,
  AgentSessionWireRefusalCode
} from '../../../src/shared/agent-session-wire'
import { structuredAgentSessionPayloadFingerprint } from '../../../src/shared/structured-agent-session-mutation'
import {
  agentSessionRefusalNotice,
  agentSessionWriteNoticeEnglish,
  agentSessionWriteNoticeParts
} from '../../../src/shared/agent-session-refusal-notice'
import {
  agentSessionRefusalFailure,
  agentSessionThrownFailure,
  agentSessionWriteKindForMethod,
  readAgentSessionErrorRefusal,
  type AgentSessionWriteKind
} from '../../../src/shared/agent-session-write-failure'
import { structuredSessionOperationId } from './structured-session-operation-id'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { RpcClient } from '../transport/rpc-client'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import { MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS } from './mobile-native-chat-send'

export const STRUCTURED_SEND_TIMEOUT_MS = 15_000

export type StructuredAgentSessionMutationCallResult<TValue> =
  | { status: 'accepted'; value: TValue }
  /** `message` is worded from the refusal's code and reason, never its own message (Orca #22999):
   *  every code has a host path whose message is written for a log. `refusal` is the host's, for
   *  a caller that has words of its own for a reason (rewind). */
  | {
      status: 'refused'
      code: AgentSessionWireRefusalCode
      message: string
      refusal?: AgentSessionWireRefusal
    }
  /** `code` is the RPC error code a pre-handler refusal came with; `hostMessage` its own text, for
   *  a caller that explains a cause the notice table cannot see (an answer too long for the host). */
  | { status: 'failed'; message: string; code?: string; hostMessage?: string }
  /** `hostReportedOperationUnknown` separates a host answer about the id from doubt
   *  about the effect. Whether that id can still be retried is the method's own
   *  question: a plan that recovers an unknown ledger row replays or reruns it, one
   *  that does not refuses the same id until the row expires. (Orca #20868.) */
  | { status: 'unknown'; hostReportedOperationUnknown?: true }

export type StructuredAgentSessionMutationResult<TValue> =
  | { status: 'accepted'; value: TValue; sameFence: boolean }
  | { status: 'rejected' }
  | { status: 'unknown' }

export type MutateOptions = {
  /** Where a host refusal is said; the chat's banner when absent. A pick from the
   *  open option drawer brings its own, because that banner draws under it. */
  onError?: (message: string) => void
  /** Rewords a failure before it is said, for a call whose failure has a cause the host's own
   *  text does not name. `code` is the RPC error code of a pre-handler refusal, else null, and
   *  `message` then the host's own text; for a refusal it is the notice the phone would show. */
  explainFailure?: (failure: { code: string | null; message: string }) => string
}

/** The words a failed or refused mutation is reported in. */
export function failureMessage(
  result:
    | { status: 'failed'; message: string; code?: string; hostMessage?: string }
    | { status: 'refused'; message: string },
  options?: MutateOptions
): string {
  return options?.explainFailure
    ? options.explainFailure({
        code: result.status === 'failed' ? (result.code ?? null) : null,
        message: result.status === 'failed' ? (result.hostMessage ?? result.message) : result.message
      })
    : result.message
}

export type StructuredAgentSessionMutate = <TValue>(
  method: string,
  fingerprintMethod: string,
  fields: Record<string, unknown>,
  options?: MutateOptions
) => Promise<StructuredAgentSessionMutationResult<TValue>>

class AgentSessionRpcResponseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** A thrown refusal's reason rides here; its message is only the bare code (Orca #23674). */
    readonly data?: unknown
  ) {
    super(message)
  }
}

/** A failed read of a chat's history as the chat shows it, from a thrown error or a stream's error
 *  frame (`{ message, error }`). A refusal the host throws has the bare code as its message, so its
 *  words come from the refusal in the error's data (Orca #23674); any other failure keeps its own
 *  text, as before. */
export function agentSessionReadFailureText(failure: unknown): string {
  const refusal = readAgentSessionErrorRefusal(
    typeof failure === 'object' && failure !== null && 'error' in failure ? failure.error : failure
  )
  if (refusal) {
    return agentSessionWriteNoticeEnglish(
      agentSessionWriteNoticeParts(agentSessionRefusalFailure(refusal), 'read-history')
    )
  }
  if (failure instanceof Error) {
    return failure.message
  }
  return typeof failure === 'object' && failure !== null
    ? 'message' in failure
      ? String(failure.message ?? '')
      : ''
    : String(failure)
}

/** A refused phone send goes back into the composer; there is no Retry control. */
function phoneWriteKind(
  fingerprintMethod: string,
  fields: Record<string, unknown>
): AgentSessionWriteKind {
  const write = agentSessionWriteKindForMethod(fingerprintMethod, fields)
  return write === 'send' ? 'composer-send' : write
}

export async function callAgentSession<TResult>(
  client: RpcClient,
  method: string,
  params: unknown,
  timeoutMs = STRUCTURED_SEND_TIMEOUT_MS,
  options?: { failWhenDisconnected?: boolean }
): Promise<TResult> {
  const response = await client.sendRequest(method, params, {
    timeoutMs,
    budgetSpansConnect: true,
    ...(options?.failWhenDisconnected ? { failWhenDisconnected: true } : {})
  })
  if (!response.ok) {
    throw new AgentSessionRpcResponseError(
      response.error.code,
      response.error.message,
      response.error.data
    )
  }
  return response.result as TResult
}

// The id minting lives in structured-session-operation-id.ts (Group B's #21137
// extraction, the create path mints one too); upstream's send module imports it
// from here, so it is re-exported.
export { structuredSessionOperationId } from './structured-session-operation-id'

function isReplayableStructuredSessionOperationId(operationId: string, now: number): boolean {
  const timestamp = parseAgentSessionOperationTimestamp(operationId)
  return (
    timestamp !== null &&
    timestamp <= now + AGENT_SESSION_OPERATION_FUTURE_SKEW_MS &&
    now - timestamp <= AGENT_SESSION_MAX_OPERATION_REPLAY_AGE_MS
  )
}

/**
 * Retains transient non-send mutation ids while the host can still replay them. Structured sends
 * use the durable journal because delivery ambiguity itself does not expire.
 */
export function retainStructuredSessionOperationId(
  operationIds: Map<string, string>,
  key: string,
  operationId?: string,
  now: number = Date.now()
): string {
  const retainedOperationId =
    operationId && isReplayableStructuredSessionOperationId(operationId, now)
      ? operationId
      : structuredSessionOperationId(now)
  operationIds.delete(key)
  operationIds.set(key, retainedOperationId)
  for (const [retainedKey, retainedId] of operationIds) {
    if (retainedKey === key) {
      continue
    }
    if (!isReplayableStructuredSessionOperationId(retainedId, now)) {
      operationIds.delete(retainedKey)
    }
  }
  return retainedOperationId
}

export function timeoutForDeadline(deadline: number | undefined): number | null {
  if (deadline === undefined) {
    return STRUCTURED_SEND_TIMEOUT_MS
  }
  const timeoutMs = deadline - Date.now()
  return timeoutMs >= MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS ? timeoutMs : null
}

export async function requestStructuredAgentSessionMutation<TValue>(args: {
  client: RpcClient
  method: string
  fingerprintMethod: string
  sessionId: string
  expectedRuntimeFence: number
  fields: Record<string, unknown>
  clientOperationId?: string
  timeoutMs?: number
}): Promise<StructuredAgentSessionMutationCallResult<TValue>> {
  const {
    client,
    method,
    fingerprintMethod,
    sessionId,
    expectedRuntimeFence,
    fields,
    clientOperationId,
    timeoutMs
  } = args
  try {
    const result = await callAgentSession<AgentSessionMutationResult<TValue>>(
      client,
      method,
      {
        envelope: {
          sessionId,
          clientOperationId: clientOperationId ?? structuredSessionOperationId(),
          expectedRuntimeFence,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: fingerprintMethod,
            sessionId,
            fields
          })
        },
        ...fields
      },
      timeoutMs
    )
    if (
      !result.ok &&
      (method === 'agentSession.cancel' || method === 'agentSession.conversationCommand') &&
      result.refusal.code === 'agent_session_operation_unknown'
    ) {
      return { status: 'unknown', hostReportedOperationUnknown: true }
    }
    return result.ok
      ? { status: 'accepted', value: result.value }
      : {
          status: 'refused',
          code: result.refusal.code,
          message: agentSessionRefusalNotice(
            result.refusal,
            phoneWriteKind(fingerprintMethod, fields)
          ),
          refusal: result.refusal
        }
  } catch (error) {
    // A refusal the host threw (its reason in the error's data), or an RPC error the host answers
    // before running the method (Orca #22999's rule, `agentSessionRpcErrorFailure`), proves the
    // write did not happen; its words come from the refusal, never the error's text, which is a
    // bare code or written for a log. Anything else may have run, and stays unconfirmed below.
    if (error instanceof AgentSessionRpcResponseError) {
      const answered = agentSessionThrownFailure(error, error.code)
      if (answered.kind !== 'unconfirmed') {
        return {
          status: 'failed',
          message: agentSessionWriteNoticeEnglish(
            agentSessionWriteNoticeParts(answered, phoneWriteKind(fingerprintMethod, fields))
          ),
          code: error.code,
          hostMessage: error.message
        }
      }
    }
    if (
      isRpcDeliveryUnknown(error) ||
      isLogicalClientCutoverError(error) ||
      error instanceof AgentSessionRpcResponseError
    ) {
      return { status: 'unknown' }
    }
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Request not sent'
    }
  }
}
