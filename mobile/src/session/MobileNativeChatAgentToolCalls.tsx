import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { RunSheetRowView } from './MobileNativeChatRunSheet'
import type { AgentToolCallsProps } from './native-chat-agent-tool-calls-slot'
import { useNativeChatAgentRuns } from './native-chat-tasks-context'
import { stopWatchingSubagentActivity, useSubagentActivityFeeds, watchSubagentActivity } from './subagent-activity-store'
import { openSubagentTranscript } from './subagent-transcript-store'

/**
 * An Agent call's own calls, under "Tool calls (N)", as the Claude app's Agent
 * sheet lists them (1.261009.20, `y030.A`; parity gap G29), and "View
 * transcript" for the whole of it in the subagent viewer.
 *
 * The calls come from the agent's own transcript, read through the feed the
 * Background tasks sheet uses (`subagent-activity-store.ts`, fed by the
 * session screen's MobileSubagentActivityFeeds) for as long as this is on
 * screen; the two sheets never stand open together. Nothing is listed until
 * that read has rows, and nothing for an agent that made no call. The rows are
 * the run sheet's, inert: drilling in is what the transcript viewer is for.
 */
export function MobileNativeChatAgentToolCalls({ agentId, title, inSection }: AgentToolCallsProps) {
  const { space } = useTheme()
  const runs = useNativeChatAgentRuns()
  const target = useMemo(() => runs.transcriptTarget?.(agentId, title) ?? null, [runs.transcriptTarget, agentId, title])
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
  const rows = useMemo(() => {
    if (!messages) {
      return []
    }
    const blocks: NativeChatBlock[] = messages.flatMap((message) => message.blocks)
    return runSheetRows(blocks, []).map((row) => ({ ...row, opens: false }))
  }, [messages])
  if (!target) {
    return null
  }
  const running = runs.runningIds.has(agentId)
  return (
    <>
      {rows.length > 0
        ? inSection(
            `Tool calls (${rows.length})`,
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
        onPress={() => openSubagentTranscript(target, running)}
        style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
      >
        <Txt variant="label" tone="accent" testID="agent-view-transcript-label">
          View transcript
        </Txt>
      </Pressable>
    </>
  )
}
