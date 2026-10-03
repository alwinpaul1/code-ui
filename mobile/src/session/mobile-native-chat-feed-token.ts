import { buildNativeChatSubscriptionId } from '../../../src/shared/native-chat-stream-unsubscribe'
import { structuredSessionRandomUuid } from './structured-session-operation-id'

/**
 * A chat feed's token on the host, minted once per subscription.
 *
 * Why its own: the host keys a chat feed by the token the client sends, and a second subscribe
 * under a token already held ends the first feed. Two screens on one chat (Resume from history
 * pushes a second session screen over the first) shared `agent:sessionId`, so each subscribe ended
 * the other's feed, and a late unsubscribe from a screen just left could end the one just opened.
 */
export function newNativeChatFeedToken(agent: string, sessionId: string): string {
  return buildNativeChatSubscriptionId(agent, sessionId, structuredSessionRandomUuid())
}
