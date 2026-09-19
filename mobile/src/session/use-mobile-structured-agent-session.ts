import { useCallback, useEffect, useMemo, useRef } from 'react'
import { dispatchMobileStructuredCommand } from './mobile-structured-composer-command'
import { useMobileStructuredRewind } from './mobile-structured-agent-rewind'
import { structuredAgentSessionSendBody } from '../../../src/shared/structured-agent-session-outbox'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'
import { isStructuredAgentSessionThinking } from '../../../src/shared/structured-agent-session-live-turn'
import {
  activeStructuredAgentSessionTurnId,
  hasUnansweredStructuredAgentSessionDispatch
} from '../../../src/shared/structured-agent-session-projection'
import { selectStructuredAgentTurnActivity } from './mobile-native-chat-turn-activity'
import {
  pendingStructuredApproval,
  pendingStructuredQuestion,
  projectStructuredPermission,
  projectStructuredQuestion
} from './mobile-structured-agent-prompts'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId as retainStructuredOpId,
  timeoutForDeadline,
  type StructuredAgentSessionMutationResult
} from './mobile-structured-agent-session-rpc'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentState } from './use-mobile-structured-agent-state'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'
import { useMobileStructuredAgentOptions } from './use-mobile-structured-agent-options'
import { useMobileStructuredAgentTurnTiming } from './use-mobile-structured-agent-turn-timing'
import type {
  StructuredMobileAttachment,
  StructuredMobileSession
} from './mobile-structured-agent-session-contract'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'
import { useMobileStructuredSendOperationReconciliation } from './use-mobile-structured-send-operation-reconciliation'
import {
  pendingStructuredPromptIdentity,
  requestMobileStructuredAgentSessionCancel
} from './mobile-structured-agent-session-cancel'

export function useMobileStructuredAgentSession(args: {
  client: RpcClient | null
  sessionId: string | null
  /** Host/workspace scope used to keep same provider ids isolated. */
  sourceIdentity?: string
  /** Authenticated identity the host keys mutation admission under. */
  callerIdentity?: string
  enabled: boolean
  /** Live transport only; gates the connection-scoped hold, nothing else. */
  connected: boolean
  /** Capability fact from the shared runtime status probe; null follows legacy cancellation. */
  promptCancelSupported?: boolean | null
  agent: string | null
  onSendError: (message: string) => void
}): StructuredMobileSession {
  const {
    agent,
    callerIdentity = '',
    client,
    connected,
    sessionId,
    sourceIdentity = '',
    enabled,
    onSendError,
    promptCancelSupported = null
  } = args
  const sessionKey = encodeNativeChatTranscriptIdentity([sourceIdentity, agent, sessionId])
  const operationIdsRef = useRef(new Map<string, string>())
  const commandPendingRef = useRef(false)
  useEffect(() => () => operationIdsRef.current.clear(), [])
  const stateArgs = { client, sessionId, sessionKey, enabled, connected }
  const { state, stateRef, loadingOlder, loadEarlier } = useMobileStructuredAgentState(stateArgs)
  useMobileStructuredSendOperationReconciliation(state.submissions)

  const mutate = useCallback(
    async <TValue>(
      method: string,
      fingerprintMethod: string,
      fields: Record<string, unknown>
    ): Promise<StructuredAgentSessionMutationResult<TValue>> => {
      const current = stateRef.current
      if (!client || !sessionId || !enabled || current.fence === null) {
        return { status: 'rejected' }
      }
      const targetFence = current.fence
      const key = `${sessionKey}:${fingerprintMethod}:${JSON.stringify(fields)}`
      const clientOperationId = retainStructuredOpId(
        operationIdsRef.current,
        key,
        operationIdsRef.current.get(key)
      )
      const result = await requestStructuredAgentSessionMutation<TValue>({
        client,
        method,
        fingerprintMethod,
        sessionId,
        expectedRuntimeFence: targetFence,
        fields,
        clientOperationId
      })
      if (result.status === 'accepted') {
        operationIdsRef.current.delete(key)
        return {
          status: 'accepted',
          value: result.value,
          sameFence: stateRef.current.fence === targetFence
        }
      }
      if (result.status === 'unknown') {
        // Prompt/option plans cannot repeat a harmful effect under a fresh id;
        // issue a fresh id so a retry can be admitted after the user checks the
        // stream. Sends keep theirs — see `mobile-structured-send-delivery.ts`.
        operationIdsRef.current.delete(key)
        return result
      }
      operationIdsRef.current.delete(key)
      onSendError(result.message)
      return { status: 'rejected' }
    },
    [client, enabled, onSendError, sessionId, sessionKey]
  )

  const {
    conversationCommands,
    optionPickerRequest,
    invokeStructuredOption,
    optionSnapshot,
    optionSurface,
    pendingOptionId,
    rewindSupport,
    setStructuredOption
  } = useMobileStructuredAgentOptions({
    agent,
    client,
    sessionId,
    enabled,
    fence: state.fence,
    mutate
  })

  const sendWithOutcome = useCallback(
    async (
      text: string,
      images?: string[],
      deadline?: number,
      attachments?: readonly StructuredMobileAttachment[]
    ): Promise<MobileNativeChatSendOutcome> => {
      const currentFence = stateRef.current.fence
      if (!client || !sessionId || !enabled || currentFence === null) {
        onSendError('Message not sent (disconnected)')
        return 'rejected'
      }
      const timeoutMs = timeoutForDeadline(deadline)
      if (timeoutMs === null) {
        onSendError('Message not sent')
        return 'rejected'
      }
      if (attachments === undefined && images !== undefined && images.length > 0) {
        onSendError('Message not sent')
        return 'rejected'
      }
      const sendAttachments = attachments ?? []
      const commandOutcome = await dispatchMobileStructuredCommand({
        text,
        hasAttachments: Boolean(sendAttachments.length || images?.length),
        client,
        sessionId,
        fence: currentFence,
        sessionKey,
        pending: commandPendingRef,
        operationIds: operationIdsRef.current,
        controller: {
          agent: agent === 'claude' ? 'claude' : 'codex',
          snapshot: optionSnapshot,
          setOption: setStructuredOption,
          invokeAction: invokeStructuredOption,
          conversationCommands
        },
        canRun: () =>
          !activeStructuredAgentSessionTurnId(stateRef.current.items) &&
          !stateRef.current.items.some(
            (item) => pendingStructuredApproval(item) || pendingStructuredQuestion(item)
          ),
        onError: onSendError,
        timeoutMs
      })
      if (commandOutcome !== null) {
        return commandOutcome
      }
      const body = structuredAgentSessionSendBody(text, sendAttachments)
      if (body.blocks.length === 0) {
        return 'rejected'
      }
      return sendMobileStructuredAgentSessionMessage({
        client,
        sessionId,
        sessionKey,
        callerIdentity,
        expectedRuntimeFence: currentFence,
        text,
        attachments: sendAttachments,
        deadline,
        onError: onSendError
      })
    },
    [
      agent,
      callerIdentity,
      client,
      conversationCommands,
      enabled,
      invokeStructuredOption,
      onSendError,
      optionSnapshot,
      sessionId,
      sessionKey,
      setStructuredOption
    ]
  )
  const { groupedDraft, respondPermission, respondQuestion } = useMobileStructuredPromptResponses({
    stateRef,
    sessionKey,
    mutate,
    onSendError
  })

  const requestCancel = useCallback(
    (prompt?: { itemId: string; expectedRevision: number }): Promise<boolean> =>
      requestMobileStructuredAgentSessionCancel({
        client,
        enabled,
        onSendError,
        operationIds: operationIdsRef.current,
        prompt,
        promptCancelSupported,
        sessionId,
        sessionKey,
        stateRef
      }),
    [client, enabled, onSendError, promptCancelSupported, sessionId, sessionKey, stateRef]
  )

  // Conversation only: the host wraps no file restore (see the dispatcher's header).
  const rewindToItem = useMobileStructuredRewind({
    client, sessionId, enabled, sessionKey, stateRef,
    operationIds: operationIdsRef.current, onError: onSendError
  })

  const stopBackgroundTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      // The host reads `turnId: 'background-tasks'` as the scope marker, not as
      // a real turn — a background task outlives the turn that launched it.
      const result = await mutate('agentSession.cancel', 'agentSession.cancel', {
        turnId: 'background-tasks',
        scope: 'background-tasks',
        taskId
      })
      return result.status === 'accepted'
    },
    [mutate]
  )

  const messages = useMemo(
    () => projectStructuredAgentSessionMessages(state.items, [], state.submissions),
    [state.items, state.submissions]
  )
  const turnId = activeStructuredAgentSessionTurnId(state.items)
  const turnTiming = useMobileStructuredAgentTurnTiming(state, turnId)
  // "Thinking" means the turn is reasoning right now, read off the journal's
  // tail, not inferred from the turn having produced nothing yet (Orca #19977).
  const turnThinking = isStructuredAgentSessionThinking(state.items)
  const turnActivity = useMemo(
    () => selectStructuredAgentTurnActivity(state.items, turnId, state.activity),
    [state.activity, state.items, turnId]
  )
  const status = state.status === 'idle' ? 'idle' : state.status
  const approvalPrompt = useMemo(
    () => state.items.find(pendingStructuredApproval) ?? null,
    [state.items]
  )
  const questionPrompt = useMemo(
    () => state.items.find(pendingStructuredQuestion) ?? null,
    [state.items]
  )
  return {
    conversationCommands,
    optionPickerRequest,
    session: {
      messages,
      status,
      transcriptLoading: status === 'loading',
      error: state.error,
      hasMore: state.hasOlder,
      loadingEarlier: loadingOlder,
      loadEarlier
    },
    isWorking:
      turnId !== null ||
      hasUnansweredStructuredAgentSessionDispatch(state.submissions, state.fence),
    canStop: turnId !== null,
    turnId,
    ...turnTiming,
    turnThinking,
    turnActivity,
    sendWithOutcome,
    cancel: () => {
      void requestCancel()
    },
    cancelPrompt: (prompt?: { itemId: string; expectedRevision: number }) =>
      requestCancel(prompt ?? pendingStructuredPromptIdentity(stateRef.current.items)),
    permission: projectStructuredPermission(approvalPrompt),
    question: projectStructuredQuestion(questionPrompt, groupedDraft),
    optionSnapshot,
    optionSurface,
    pendingOptionId,
    // `null` is the provider clearing a catalog it once reported; both that and
    // "never reported" mean the composer keeps its curated catalog.
    sessionCommands: state.commands ?? undefined,
    backgroundTasks: state.backgroundTasks,
    stopBackgroundTask,
    rewindSupport,
    rewindToItem,
    respondPermission,
    respondQuestion,
    setStructuredOption,
    invokeStructuredOption
  }
}
