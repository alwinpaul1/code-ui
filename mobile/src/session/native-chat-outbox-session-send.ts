import { structuredAgentSessionHolderId } from '../../../src/shared/structured-agent-session-holder'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { callAgentSession } from './mobile-structured-agent-session-rpc'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'
import { OUTBOX_HEADLESS_READ_MS } from './native-chat-outbox-headless'

/**
 * How the app-wide drainer (native-chat-outbox-drainer.ts) sends a structured entry with no chat
 * on screen. It needs no look first: every attempt carries the entry's one operation id, and the
 * host's ledger answers a repeat with the first attempt's result, so a resend can never post the
 * message twice. It holds the session for the send, as the chat does while it shows it, reads the
 * fence from one event of the session's feed, sends, and lets the session go.
 */

/** The session's runtime fence, from the first event of its feed that states one (its snapshot
 *  does: AgentSessionSubscribeEvent), or null. */
function readSessionFence(client: RpcClient, sessionId: string): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false
    let unsubscribe: () => void = () => {}
    const finish = (fence: number | null): void => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      queueMicrotask(() => unsubscribe())
      resolve(fence)
    }
    const timer = setTimeout(() => finish(null), OUTBOX_HEADLESS_READ_MS)
    try {
      unsubscribe = client.subscribe('agentSession.subscribe', { sessionId }, (raw) => {
        const event = (raw ?? {}) as { type?: unknown; fence?: unknown }
        if (event.type === 'error' || event.type === 'end') {
          finish(null)
          return
        }
        if (typeof event.fence === 'number') {
          finish(event.fence)
        }
      })
      if (done) {
        unsubscribe()
      }
    } catch {
      finish(null)
    }
  })
}

/** Sends a structured entry again under its one operation id, holding the session for the send
 *  as the chat does while it shows it. */
export async function sendSessionOutboxEntry(
  client: RpcClient,
  entry: NativeChatOutboxEntry
): Promise<MobileNativeChatSendOutcome> {
  const sessionId = entry.route?.sessionId
  if (!sessionId) {
    return 'rejected'
  }
  const holderId = structuredAgentSessionHolderId('mobile-outbox')
  let held = false
  try {
    try {
      await callAgentSession(client, 'agentSession.hold', { sessionId, holderId }, OUTBOX_HEADLESS_READ_MS, {
        failWhenDisconnected: true
      })
      held = true
    } catch {
      return 'rejected'
    }
    const fence = await readSessionFence(client, sessionId)
    if (fence === null) {
      return 'rejected'
    }
    return await sendMobileStructuredAgentSessionMessage({
      client,
      sessionId,
      expectedRuntimeFence: fence,
      text: entry.text,
      attachments: entry.attachments ?? [],
      operationId: entry.operationId,
      // The drainer keeps the outcome; nothing is said in a chat that is not on screen.
      onError: () => {}
    })
  } finally {
    if (held) {
      void callAgentSession(client, 'agentSession.release', { sessionId, holderId }, undefined, {
        failWhenDisconnected: true
      }).catch(() => undefined)
    }
  }
}
