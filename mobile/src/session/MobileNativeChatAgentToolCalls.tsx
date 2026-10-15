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
import { openSubagentTranscript } from './subagent-transcript-store'

/**
 * An Agent call's own calls, under "Tool calls (N)", as the Claude app's Agent
 * sheet lists them (1.261009.20, `y030.A`; parity gap G29), and "View
 * transcript" for the whole of it in the subagent viewer.
 *
 * With Anthropic's stream live (a matched Claude tab), the calls come from the stream: the events
 * whose `parent_tool_use_id` is this Agent call, as the Claude app keeps them with the call (G8;
 * 1009 nq8.java:937-949), and View transcript opens those rows. When the stream holds no call of
 * the agent's (none yet, an older window, no live stream), they come from the file, as follows.
 *
 * The calls come from the agent's own transcript, read through the feed the
 * Background tasks sheet uses (`subagent-activity-store.ts`, fed by the
 * session screen's MobileSubagentActivityFeeds) for as long as this is on
 * screen; the two sheets never stand open together. Nothing is listed until
 * that read has rows, and nothing for an agent that made no call. The rows are
 * the run sheet's, inert: drilling in is what the transcript viewer is for.
 */
export function MobileNativeChatAgentToolCalls({ agentId, title, inSection, toolUseId = null }: AgentToolCallsProps) {
  const { space } = useTheme()
  const runs = useNativeChatAgentRuns()
  const target = useMemo(() => runs.transcriptTarget?.(agentId, title) ?? null, [runs.transcriptTarget, agentId, title])
  const streamEvents = useClaudeChatLive()?.stream?.events ?? null
  const streamed = useMemo(() => (streamEvents && toolUseId ? ccrSubagentMessages(streamEvents, toolUseId) : []), [streamEvents, toolUseId])
  const streamedRows = useMemo(() => toolCallRows(streamed), [streamed])
  const fromStream = streamedRows.length > 0
  const [owner] = useState(() => ({}))
  useEffect(() => {
    if (!target || fromStream) {
      return undefined
    }
    watchSubagentActivity(owner, [target])
    return () => stopWatchingSubagentActivity(owner)
  }, [fromStream, owner, target])
  const feeds = useSubagentActivityFeeds()
  // The feed reads the transcript's latest page only; with earlier pages
  // unread the count is a floor, and says so ("Tool calls (40+)").
  const windowedIds = useSubagentFeedsWindowed()
  const windowed = !fromStream && windowedIds.has(agentId)
  const messages = target ? feeds.get(target.agentId) : undefined
  const fileRows = useMemo(() => (messages ? toolCallRows(messages) : []), [messages])
  const rows = fromStream ? streamedRows : fileRows
  if (!target) {
    return null
  }
  const running = runs.runningIds.has(agentId)
  // The viewer draws the stream's rows when the stream holds any of the agent's, text included.
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
