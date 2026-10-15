import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { RunSheetRowView } from './MobileNativeChatRunSheet'
import type { AgentToolCallsProps } from './native-chat-agent-tool-calls-slot'
import { ccrSubagentMessages } from './ccr-background-tasks'
import { useClaudeChatLive } from './claude-chat-live'
import { useNativeChatAgentRuns } from './native-chat-tasks-context'
import {
  stopWatchingSubagentActivity,
  useSubagentActivityFeeds,
  useSubagentFeedsWindowed,
  watchSubagentActivity
} from './subagent-activity-store'
import { unionSubagentMessages } from './subagent-stream-file-union'
import { openSubagentTranscript } from './subagent-transcript-store'

/**
 * An Agent call's own calls, under "Tool calls (N)", as the Claude app's Agent
 * sheet lists them (1.261009.20, `y030.A`; parity gap G29), and "View
 * transcript" for the whole of it in the subagent viewer.
 *
 * The agent's file is the baseline, read through the feed the Background tasks
 * sheet uses (`subagent-activity-store.ts`, fed by the session screen's
 * MobileSubagentActivityFeeds) for as long as this is on screen; the two sheets
 * never stand open together. With Anthropic's stream live (a matched Claude
 * tab), the events whose `parent_tool_use_id` is this Agent call add what the
 * file does not hold yet, as the Claude app keeps them with the call (G8; 1009
 * nq8.java:937-949), de-duplicated by row and tool_use id
 * (`subagent-stream-file-union.ts`). The stream alone is never the count: the
 * tab's store drops a subagent's older events. Until the file has answered,
 * the stream's calls show with the count as a floor ("Tool calls (1+)").
 * Nothing is listed for an agent that made no call. The rows are the run
 * sheet's, inert: drilling in is what the transcript viewer is for.
 */
export function MobileNativeChatAgentToolCalls({ agentId, title, inSection, toolUseId = null }: AgentToolCallsProps) {
  const { space } = useTheme()
  const runs = useNativeChatAgentRuns()
  const target = useMemo(() => runs.transcriptTarget?.(agentId, title) ?? null, [runs.transcriptTarget, agentId, title])
  const streamEvents = useClaudeChatLive()?.stream?.events ?? null
  const streamed = useMemo(() => (streamEvents && toolUseId ? ccrSubagentMessages(streamEvents, toolUseId) : []), [streamEvents, toolUseId])
  const [owner] = useState(() => ({}))
  useEffect(() => {
    if (!target) {
      return undefined
    }
    watchSubagentActivity(owner, [target])
    return () => stopWatchingSubagentActivity(owner)
  }, [owner, target])
  const feeds = useSubagentActivityFeeds()
  const messages = target ? feeds.get(target.agentId) : undefined
  const rows = useMemo(() => toolCallRows(unionSubagentMessages(messages ?? [], streamed)), [messages, streamed])
  // A floor, never an exact count: the feed reads the transcript's latest page only (earlier
  // pages unread), or the file has not answered and the rows are the stream's alone.
  const windowed = useSubagentFeedsWindowed().has(agentId) || messages === undefined
  if (!target) {
    return null
  }
  const running = runs.runningIds.has(agentId)
  // The viewer adds the stream's rows (text included) to the file's when the stream holds any.
  const stream = streamEvents && toolUseId && streamed.length > 0 ? { toolUseId, events: streamEvents } : null
  return (
    <>
      {rows.length > 0
        ? inSection(
            `Tool calls (${rows.length}${windowed ? '+' : ''})`,
            <View style={{ gap: space.xs }}>
              {rows.map((row, index) => (
                <RunSheetRowView key={index} row={row} testID="agent-tool-call-row" />
              ))}
            </View>
          )
        : null}
      <Pressable
        accessibilityRole="link"
        testID="agent-view-transcript"
        hitSlop={8}
        onPress={() => openSubagentTranscript(target, running, stream)}
        style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
      >
        <Txt variant="label" tone="accent" testID="agent-view-transcript-label">
          View transcript
        </Txt>
      </Pressable>
    </>
  )
}

/** An agent's calls as the Agent sheet lists them: the run sheet's rows, inert. */
function toolCallRows(messages: readonly NativeChatMessage[]) {
  const blocks: NativeChatBlock[] = messages.flatMap((message) => message.blocks)
  return runSheetRows(blocks, []).map((row) => ({ ...row, opens: false }))
}
