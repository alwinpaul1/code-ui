import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

/** Mounts both transcript sources and hands back the one this tab's lane owns.
 *  Both hooks always run (hook order is fixed); the inactive lane is starved of
 *  its identity inputs rather than unmounted, so a lane flip keeps its cache. */
export function useMobileNativeChatSessionLane({
  client,
  structured,
  agent,
  resolvedAgent,
  transcriptPath,
  sessionId,
  sourceIdentity,
  enabled,
  connState,
  onSendError
}: {
  client: RpcClient | null
  structured: boolean
  /** Agent id for the structured provider session. */
  agent: string | null
  /** Agent resolved from the terminal, for the bridge transcript reader. */
  resolvedAgent: string | null
  transcriptPath: string | null
  sessionId: string | null
  sourceIdentity: Parameters<typeof useMobileNativeChatSession>[0]['sourceIdentity']
  enabled: boolean
  connState: ConnectionState
  onSendError: (message: string) => void
}): {
  structuredSession: ReturnType<typeof useMobileStructuredAgentSession>
  session: ReturnType<typeof useMobileNativeChatSession>
} {
  // `sourceIdentity` is `hostId\0workspaceId`; the host half is all this needs.
  // Read here rather than threaded from the controller because that file and
  // the session route both sit exactly at their max-lines caps.
  const lastConnectedAt = useLastConnectedAt(sourceIdentity.split('\0')[0] || undefined)
  const bridgeSession = useMobileNativeChatSession({
    client,
    sourceIdentity,
    agent: structured ? null : resolvedAgent,
    sessionId: structured ? null : sessionId,
    transcriptPath: structured ? null : transcriptPath,
    lastConnectedAt
  })
  const structuredSession = useMobileStructuredAgentSession({
    client,
    sessionId: structured ? sessionId : null,
    sourceIdentity,
    enabled,
    // Holds are connection-scoped; dropping this on transport loss lets the hook
    // reacquire the provider without clearing the cached transcript.
    connected: connState === 'connected',
    agent: structured ? agent : null,
    onSendError
  })
  return {
    structuredSession,
    session: structured ? structuredSession.session : bridgeSession
  }
}
