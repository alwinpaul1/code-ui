import type { ReactNode } from 'react'
import { pairToolBlocks, type NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { ClaudeChatLiveStream } from './claude-chat-live'
import type { BackgroundTask } from './mobile-background-tasks'
import { readLaunch } from './mobile-background-task-transcript'
import { toolCallKind } from './mobile-native-chat-tool-kind'

export type AgentTaskPairs = { byCallId: Map<string, NativeChatToolPair>; byLaunchedId: Map<string, NativeChatToolPair> }

/** Every Agent call in the conversation, by its `toolu_…` id and by the agent id its launch
 *  result names: built once per conversation, looked up per row. */
export function agentTaskPairs(messages: readonly NativeChatMessage[]): AgentTaskPairs {
  const byCallId = new Map<string, NativeChatToolPair>()
  const byLaunchedId = new Map<string, NativeChatToolPair>()
  const blocks: NativeChatBlock[] = messages.flatMap((message) => message.blocks)
  for (const pair of pairToolBlocks(blocks)) {
    const call = pair.call
    if (!call || toolCallKind(call.name) !== 'agent') {
      continue
    }
    if (call.callId) {
      byCallId.set(call.callId, pair)
    }
    const launched = readLaunch({ name: call.name, input: call.input, startedAt: null }, pair.result?.output ?? '')
    if (launched?.kind === 'agent') {
      byLaunchedId.set(launched.id, pair)
    }
  }
  return { byCallId, byLaunchedId }
}

/** The Agent call a task was launched by: the call whose id is the task's `toolUseId` (Anthropic's
 *  rows), else (the desktop's rows, which name no call) the one whose launch result names its id. */
export function findAgentTaskPair(pairs: AgentTaskPairs, task: Pick<BackgroundTask, 'id' | 'toolUseId'>): NativeChatToolPair | null {
  return (task.toolUseId ? pairs.byCallId.get(task.toolUseId) : pairs.byLaunchedId.get(task.id)) ?? null
}

/** The page an agent's "View transcript" pushes into the Background tasks sheet, handed to the
 *  sheet by the tab's tasks provider (MobileBackgroundTaskTranscriptPage.tsx) rather than imported
 *  by it: the page draws the tool detail sheet's body and the run sheet's rows, which the sheet's
 *  own render tests have no reason to mount. Without it the sheet offers no link. */
export type BackgroundTaskTranscriptPage = {
  header: (props: { task: BackgroundTask; pair: NativeChatToolPair | null; onBack: () => void }) => ReactNode
  body: (props: { task: BackgroundTask; pair: NativeChatToolPair | null; stream: ClaudeChatLiveStream | null }) => ReactNode
}
