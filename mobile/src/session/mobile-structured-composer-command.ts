import type {
  AgentSessionConversationCommand,
  AgentSessionConversationCommandResult
} from '../../../src/shared/agent-session-conversation-command'
import {
  dispatchStructuredAgentSessionComposerCommand,
  isStructuredAgentSessionComposerCommand,
  type StructuredAgentSessionCommandRefusalCause,
  type StructuredAgentSessionComposerOptions
} from '../../../src/shared/structured-agent-session-composer'
import { agentSessionWriteNoticeEnglish } from '../../../src/shared/agent-session-refusal-notice'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId
} from './mobile-structured-agent-session-rpc'

/** What the person sees and can do, in the words the desktop uses (Orca #25704). */
function busyCommandText(
  command: AgentSessionConversationCommand,
  busy: 'working' | 'prompt'
): string {
  const clear = command === 'clear'
  return agentSessionWriteNoticeEnglish(
    busy === 'prompt'
      ? [clear ? 'clearAfterAnswer' : 'compactAfterAnswer']
      : ['agentStillWorking', clear ? 'runClearWhenDone' : 'runCompactWhenDone']
  )
}

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
  /** What the agent still has in flight that refuses a command now; null when nothing does. */
  busy: () => 'working' | 'prompt' | null
  /** `refusedWhile`: what the phone showed the refused command waiting on, so its line goes
   *  once that ends (use-mobile-native-chat-send-error.ts). */
  onError: (message: string, refusedWhile?: StructuredAgentSessionCommandRefusalCause) => void
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
      // No `delivery: 'queue-if-active'` here: a /compact waits in line only where the host's
      // queued-message cards render, and this phone has none (see the port inventory).
      const busy = input.busy()
      if (busy) {
        return { accepted: false, error: busyCommandText(command, busy), refusedWhile: busy }
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
    input.onError(outcome.error, outcome.refusedWhile)
  }
  return unknown ? 'unknown' : outcome.accepted ? 'accepted' : 'rejected'
}
