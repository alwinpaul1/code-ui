import { getBackgroundLinkWatcher } from '../background/background-link'
import { sessionTabsListRead } from '../session/mobile-session-read-operations'
import type { SessionTabsResult } from '../session/mobile-session-route-types'
import { OUTBOX_HEADLESS_READ_MS, readTranscriptOnce } from '../session/native-chat-outbox-headless'
import { newOutboxSendId } from '../session/native-chat-outbox-sends'
import { structuredSessionOperationId } from '../session/structured-session-operation-id'
import { changeNativeChatOutbox } from '../storage/native-chat-outbox'
import { loadHostCatalog } from '../transport/host-store'
import { peekLiveHostClient } from '../transport/live-host-clients'
import type { RpcClient } from '../transport/rpc-client'
import type { SessionReplyIo } from './session-reply-response'

/** The worktree's tab list over the link, or null when it cannot be read: the same read the outbox
 *  drainer makes (native-chat-outbox-headless.ts), so a tab is found by what the drainer will see. */
async function readTabs(client: RpcClient, worktreeId: string): Promise<SessionTabsResult | null> {
  try {
    const response = await sessionTabsListRead.request(
      client,
      { worktree: worktreeId },
      { timeoutMs: OUTBOX_HEADLESS_READ_MS, failWhenDisconnected: true }
    )
    if (!response.ok) {
      return null
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reply is the session tab snapshot (session-read-reply-schema.ts reads it as unknown); every field used is checked where it is read (session-reply-response.ts).
    const result = sessionTabsListRead.interpret(response) as SessionTabsResult | null
    return result && Array.isArray(result.tabs) ? result : null
  } catch {
    return null
  }
}

/** What the reply path touches on a phone: the UI's link to the host, or the background watcher's
 *  (the one the banner's event came over when the app was in the background), the outbox the
 *  composer writes to, and the transcript read the drainer makes. */
export function productionSessionReplyIo(): SessionReplyIo {
  return {
    now: () => Date.now(),
    newId: newOutboxSendId,
    newOperationId: () => structuredSessionOperationId(),
    resolveClient: (hostId) => peekLiveHostClient(hostId) ?? getBackgroundLinkWatcher().peekClient(hostId),
    hostCredential: async (hostId) => {
      const hosts = await loadHostCatalog().catch(() => null)
      return hosts?.find((host) => host.id === hostId)?.credentialStatus ?? null
    },
    readTabs,
    readTranscript: readTranscriptOnce,
    writeEntry: (entry) => changeNativeChatOutbox((current) => [...current, entry])
  }
}
