import { useEffect } from 'react'
import {
  encodeNativeChatTranscriptIdentity,
  EMPTY_NATIVE_CHAT_TRANSCRIPT,
  type NativeChatTranscriptRetention
} from '../../../src/shared/native-chat-transcript-retention'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { useHostClient } from '../transport/host-client-hooks'
import type { RpcClient } from '../transport/rpc-client'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'
import { publishSubagentFeed, useSubagentActivityRequest } from './subagent-activity-store'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'

/** These reads are never kept for a warm start: the shared cache holds twelve
 *  chats, and six subagent files must not push the user's own chats out. */
const KEEP_NOTHING: NativeChatTranscriptRetention = {
  capture: () => undefined,
  retained: () => null,
  visible: ({ messages, settled }) => (settled ? messages : EMPTY_NATIVE_CHAT_TRANSCRIPT)
}

/**
 * The open Background tasks sheet's reads of its running subagents'
 * transcripts (`subagent-activity-store.ts`, `mobile-subagent-activity.ts`).
 * One subscription per target, through the very route the subagent viewer
 * used (`nativeChat.subscribe`, session `agent-<id>`): no file written on the
 * host, no terminal opened. Each read is torn down as soon as the sheet closes
 * or the agent leaves the request. Renders nothing.
 */
export function MobileSubagentActivityFeeds({
  hostId,
  worktreeId
}: {
  hostId: string
  worktreeId: string | null
}): React.JSX.Element | null {
  const request = useSubagentActivityRequest()
  const { client } = useHostClient(hostId)
  const lastConnectedAt = useLastConnectedAt(hostId)
  if (!request) {
    return null
  }
  return (
    <>
      {request.targets.map((target) => (
        <SubagentActivityFeed
          key={target.agentId}
          target={target}
          client={client}
          sourceIdentity={encodeNativeChatTranscriptIdentity([hostId, worktreeId, 'subagent-activity'])}
          lastConnectedAt={lastConnectedAt}
        />
      ))}
    </>
  )
}

function SubagentActivityFeed({
  target,
  client,
  sourceIdentity,
  lastConnectedAt
}: {
  target: SubagentTranscriptTarget
  client: RpcClient | null
  sourceIdentity: string
  lastConnectedAt: number | null
}): null {
  const session = useMobileNativeChatSession({
    client,
    sourceIdentity,
    agent: target.agent,
    sessionId: target.sessionId,
    transcriptPath: target.transcriptPath,
    lastConnectedAt,
    retention: KEEP_NOTHING
  })
  // Only a settled read speaks. A refused or failed read (an older host, a
  // file it will not serve) says nothing, and the agent's row stays as it was.
  const messages = session.status === 'ready' ? session.messages : null
  useEffect(() => publishSubagentFeed(target.agentId, messages), [target.agentId, messages])
  useEffect(() => () => publishSubagentFeed(target.agentId, null), [target.agentId])
  return null
}
