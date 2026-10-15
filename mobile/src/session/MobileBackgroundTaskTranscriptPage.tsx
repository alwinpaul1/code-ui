import { useMemo, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { ArrowLeft } from 'lucide-react-native'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { ccrSubagentMessages } from './ccr-background-tasks'
import type { ClaudeChatLiveStream } from './claude-chat-live'
import type { BackgroundTask } from './mobile-background-tasks'
import type { BackgroundTaskTranscriptPage } from './mobile-background-task-agent-pairs'
import { toolDetailTitle } from './mobile-native-chat-tool-detail'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { RunSheetRowView } from './MobileNativeChatRunSheet'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { AgentToolCallsSlotProvider, useAgentToolCallsSlot, type AgentToolCallsProps } from './native-chat-agent-tool-calls-slot'

/**
 * What an agent row's "View transcript" opens, as the Claude app does it (decompiled 1.261013.20):
 * the tap pushes `CodeRemoteBottomSheetDestination.ToolCallDetail` for the agent's own Agent call
 * (mm8.java `b`, 0x00a4-0x00ee: the task found by its `toolUseId`, then `x8w.l(new ToolCallDetail(
 * opz))`) onto the SAME sheet, so its top row is a back arrow, not a close cross (the user's
 * screenshot, 2026-10-15). It is that call's detail page: "Agent" over its status, "Prompt" and the
 * prompt as Markdown, then the agent's own calls under "Tool calls (N)" (`ccr_tool_prompt`,
 * `ccr_tool_calls_count`; parity gap G29). Here it is the chat's own Agent sheet body
 * (`ToolDetailBody`), so the two never drift apart.
 *
 * The agent's calls: while Anthropic's stream is live, from the stream itself (the events whose
 * `parent_tool_use_id` is the Agent call, ccr-background-tasks.ts), live as they arrive; else, or
 * while the stream holds none of them, from the agent's transcript file through the desktop, as
 * the Agent sheet reads them (MobileNativeChatAgentToolCalls.tsx).
 */

/** The page's status, in the app's tool-status words (`ccr_tool_status_*`) and, for a task Claude
 *  stopped, the sheet's own "Stopped". */
export function transcriptPageStatus(task: BackgroundTask): string {
  switch (task.status) {
    case 'running':
      return 'In progress'
    case 'failed':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    case 'completed':
    case 'finished':
      return 'Completed'
    default: {
      const unhandled: never = task.status
      return unhandled
    }
  }
}

export function MobileBackgroundTaskTranscriptHeader({ task, pair, onBack }: { task: BackgroundTask; pair: NativeChatToolPair | null; onBack: () => void }) {
  const { colors, space } = useTheme()
  return (
    // ToolDetailHeader's two centred lines, with the back arrow where its sheet has the cross.
    <View style={{ paddingHorizontal: space.sm, marginBottom: space.sm, minHeight: 44, justifyContent: 'center' }}>
      <View style={{ gap: 4, paddingHorizontal: 44 }}>
        <Txt variant="title" weight="bold" align="center" numberOfLines={1} accessibilityRole="header" testID="task-transcript-title">
          {pair ? toolDetailTitle(pair) : 'Agent'}
        </Txt>
        <Txt variant="label" tone={task.status === 'failed' ? 'danger' : 'secondary'} align="center" testID="task-transcript-status">
          {transcriptPageStatus(task)}
        </Txt>
      </View>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: space.sm, top: 0, bottom: 0, justifyContent: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <ArrowLeft size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  )
}

export function MobileBackgroundTaskTranscriptBody({
  task,
  pair,
  stream
}: {
  task: BackgroundTask
  pair: NativeChatToolPair | null
  stream: ClaudeChatLiveStream | null
}) {
  const { space } = useTheme()
  const outer = useAgentToolCallsSlot()
  const toolUseId = task.toolUseId ?? pair?.call?.callId ?? null
  const streamed = useMemo(() => (stream && toolUseId ? ccrSubagentMessages(stream.events, toolUseId) : []), [stream, toolUseId])
  const render = useMemo(
    () =>
      (props: AgentToolCallsProps): ReactNode =>
        streamed.length > 0 ? <StreamedToolCalls messages={streamed} inSection={props.inSection} /> : (outer?.(props) ?? null),
    [outer, streamed]
  )
  if (!pair) {
    // The sheet offers the link only where the call is found; the call can still leave the
    // loaded window (a reload) while the page is up.
    return (
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
        <Txt variant="caption" tone="muted">
          This agent&apos;s call is no longer in the loaded conversation.
        </Txt>
      </View>
    )
  }
  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }} testID="task-transcript-body">
      <AgentToolCallsSlotProvider render={render}>
        <ToolDetailBody pair={pair} agentId={task.id} />
      </AgentToolCallsSlotProvider>
    </View>
  )
}

function StreamedToolCalls({ messages, inSection }: { messages: readonly NativeChatMessage[]; inSection: AgentToolCallsProps['inSection'] }) {
  const { space } = useTheme()
  const rows = useMemo(() => runSheetRows(messages.flatMap((message) => message.blocks), []).map((row) => ({ ...row, opens: false })), [messages])
  if (rows.length === 0) {
    return null
  }
  return (
    <>
      {inSection(
        `Tool calls (${rows.length})`,
        <View style={{ gap: space.xs }}>
          {rows.map((row, index) => (
            <RunSheetRowView key={index} row={row} testID="agent-tool-call-row" />
          ))}
        </View>
      )}
    </>
  )
}

/** The page as the tab's tasks provider hands it to the Background tasks sheet. */
export const BACKGROUND_TASK_TRANSCRIPT_PAGE: BackgroundTaskTranscriptPage = {
  header: (props) => <MobileBackgroundTaskTranscriptHeader {...props} />,
  body: (props) => <MobileBackgroundTaskTranscriptBody {...props} />
}
