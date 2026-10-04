import type { AgentSessionConversationCommandResult } from '../../../src/shared/agent-session-conversation-command'
import {
  dispatchStructuredAgentSessionComposerCommand,
  isStructuredAgentSessionComposerCommand,
  type StructuredAgentSessionComposerOptions
} from '../../../src/shared/structured-agent-session-composer'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId
} from './mobile-structured-agent-session-rpc'

export async function dispatchMobileStructuredCommand(input: {
  text: string
  hasAttachments: boolean
  client: RpcClient
  sessionId: string
  fence: number
  sessionKey: string
  pending: { current: boolean }
  operationIds: Map<string, string>
  /** Whether the host takes every press as its own action and answers a repeat from its record
   *  (Orca #24301, a 1.4.220 host; read off `agent-session.repeated-stop.v1`, the capability that
   *  came with it). Null until the status probe answers. */
  hostAnswersRepeats: boolean | null
  controller: StructuredAgentSessionComposerOptions
  canRun: () => boolean
  onError: (message: string) => void
  timeoutMs: number
}): Promise<MobileNativeChatSendOutcome | null> {
  if (input.pending.current) {
    // Every send is turned away while a command runs (its RPC may take 195 s),
    // a plain message included. The composer gets the text back, and before
    // this nothing said why, so Send looked broken for that long (2026-09-25).
    input.onError('Not sent — a chat-session command is still running.')
    return 'rejected'
  }
  if (!isStructuredAgentSessionComposerCommand(input.text, input.controller.agent)) {
    return null
  }
  if (input.hasAttachments) {
    input.onError('Remove attachments before using a chat-session command.')
    return 'rejected'
  }
  let unknown = false
  const outcome = await dispatchStructuredAgentSessionComposerCommand(input.text, {
    ...input.controller,
    runConversationCommand: async (command) => {
      if (!input.canRun()) {
        return {
          accepted: false,
          error: 'Wait for pending work to finish before using this command.'
        }
      }
      input.pending.current = true
      // Orca #24301: against a host that answers a repeat from its record (a /clear pressed again
      // after it committed is answered with that clear), every press mints its own id, so a second
      // /compact after a lost answer compacts instead of replaying the first. An older host has no
      // such record: the retry replays the same id and learns the first one's true outcome, rather
      // than running a /clear twice or being refused as "cleared".
      const everyPressItsOwn = input.hostAnswersRepeats === true
      const key = `${input.sessionKey}:agentSession.conversationCommand:${command}`
      const clientOperationId = everyPressItsOwn
        ? undefined
        : retainStructuredSessionOperationId(input.operationIds, key, input.operationIds.get(key))
      try {
        const result =
          await requestStructuredAgentSessionMutation<AgentSessionConversationCommandResult>({
            client: input.client,
            sessionId: input.sessionId,
            expectedRuntimeFence: input.fence,
            method: 'agentSession.conversationCommand',
            fingerprintMethod: 'agentSession.conversationCommand',
            fields: { command },
            clientOperationId,
            timeoutMs: Math.max(input.timeoutMs, 195_000)
          })
        if (
          result.status === 'unknown' ||
          (result.status === 'accepted' && result.value.state === 'unknown')
        ) {
          unknown = true
          return {
            accepted: false,
            // Only an older host's retry asks about this same operation (upstream's wording for
            // the other since #24301).
            error: everyPressItsOwn
              ? 'Conversation operation was not confirmed.'
              : 'Conversation operation is unconfirmed; retry checks the same operation.'
          }
        }
        input.operationIds.delete(key)
        return result.status === 'accepted'
          ? { accepted: !result.value.error, error: result.value.error ?? null }
          : { accepted: false, error: result.message }
      } finally {
        input.pending.current = false
      }
    }
  })
  if (outcome.error) {
    input.onError(outcome.error)
  }
  return unknown ? 'unknown' : outcome.accepted ? 'accepted' : 'rejected'
}
