import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
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
 *
 * Only the session screen in focus reads: the request is the app's one open
 * sheet, and a second session screen left mounted under a pushed one (the
 * notification route can, across hosts) would otherwise read it again, on its
 * own host's connection.
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
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )
  if (!request || !focused) {
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
  // file it will not serve) says nothing, and the agent's row stays as it was;
  // a read that answered and then failed or re-reads (a reconnect) keeps what
  // it last said, so the rows do not blink back to the description and out.
  // What it said leaves with the feed itself (the agent finished, the sheet
  // closed).
  const ready = session.status === 'ready'
  useEffect(() => {
    if (ready) {
      publishSubagentFeed(target.agentId, session.messages)
    }
  }, [ready, target.agentId, session.messages])
  useEffect(() => () => publishSubagentFeed(target.agentId, null), [target.agentId])
  return null
}
