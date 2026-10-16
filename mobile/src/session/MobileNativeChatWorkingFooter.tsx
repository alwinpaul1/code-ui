import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { MobileNativeChatStatusLine, type ClaudeLiveToolRowView } from './MobileNativeChatStatusLine'
import { MobileNativeChatToolDetailSheet } from './MobileNativeChatToolDetailSheet'
import { useClaudeChatLive } from './claude-chat-live'
import { workingMarkKindFromTranscript } from './claude-working-mark-kind'
import { workingMarkKindForTool } from './claude-working-mark'
import { CLAUDE_LIVE_TOOL_ROW_ENABLED, claudeLiveToolCall, claudeLiveToolClock } from './claude-live-tool-row'
import { claudeLiveToolLabel, claudeToolIsPathLike } from './claude-live-tool-label'

/** The live tool row's clock ticks once a second while it can show a time. */
function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

/**
 * The working line as the transcript's last row, as the Claude app's "thinking_spark" item is
 * (`y07` case 15, com.anthropic.claude 1.261013.20): it scrolls with the messages. Pinned in the
 * see-through dock it lay over them once the list scrolled ("4 running tasks" drawn across a
 * paragraph on the user's phone, 0.9.154). MobileNativeChatView puts it last in the inverted
 * list's header after the queue, so it sits directly above the composer and below a queued
 * message, as in the app (the user, 2026-10-16).
 *
 * The mark follows the turn's running tool (claude-working-mark-kind.ts); Anthropic's stream says
 * whether the turn is thinking when it is live, the bridge lane's own flag otherwise.
 *
 * With the live tool row on (CLAUDE_LIVE_TOOL_ROW_ENABLED, off: the user's app does not draw it),
 * a Claude turn's running tool names the line ("Running ls  12s ›") and a tap opens
 * its detail sheet (claude-live-tool-row.ts). Codex gets none: the row is the Claude app's, read
 * from Claude Code's own tool names, and nothing Codex draws has it.
 */
export function MobileNativeChatWorkingFooter({
  messages,
  working,
  thinking,
  agent = null,
  awaitingApproval = false,
  liveToolRow = CLAUDE_LIVE_TOOL_ROW_ENABLED
}: {
  messages: readonly NativeChatMessage[]
  /** False on the structured lane, which says "Working for N" per turn: there only the count shows. */
  working: boolean
  thinking: boolean
  /** The chat's agent; only 'claude' can draw the live tool row. */
  agent?: string | null
  /** A permission or a question card is up for this turn: the app's `AwaitingApproval` header. */
  awaitingApproval?: boolean
  /** Whether the live tool row may draw; CLAUDE_LIVE_TOOL_ROW_ENABLED unless a test says otherwise. */
  liveToolRow?: boolean
}) {
  const chatLive = useClaudeChatLive()
  const liveThinking = chatLive?.footer?.thinking
  const turnStartedAt = chatLive?.footer?.turnStartedAt ?? null
  const markKind = useMemo(
    () => workingMarkKindFromTranscript(messages, liveThinking ?? thinking),
    [messages, liveThinking, thinking]
  )
  const eligible = liveToolRow && agent === 'claude' && (working || awaitingApproval)
  const toolCall = useMemo(() => (eligible ? claudeLiveToolCall(messages) : null), [eligible, messages])
  const [detailPair, setDetailPair] = useState<NativeChatToolPair | null>(null)
  // `d2k.turnStartedAtMillis`: Anthropic's turn start on a matched tab, else when the prompt was
  // recorded, the same moment from the transcript.
  const start = toolCall === null ? null : turnStartedAt ?? toolCall.promptAt
  const clocked = toolCall !== null && !awaitingApproval && start !== null
  const now = useSecondTick(clocked)
  let toolRow: ClaudeLiveToolRowView | null = null
  if (toolCall !== null) {
    const { call, result } = toolCall.pair
    const pair = toolCall.pair
    toolRow = {
      callId: call.callId ?? '',
      label: claudeLiveToolLabel(call, result),
      clock: clocked ? claudeLiveToolClock(start, now) : null,
      loading: !awaitingApproval,
      middleEllipsis: claudeToolIsPathLike(call.name),
      onPress: () => setDetailPair(pair)
    }
  }
  // y07.java:1012-1015: the row's mark is its call's kind, or waiting while it awaits approval.
  const kind =
    toolCall === null ? markKind : awaitingApproval ? 'waitingForUser' : workingMarkKindForTool(toolCall.pair.call.name)
  return (
    <View testID="native-chat-working-footer">
      <MobileNativeChatStatusLine working={working} markKind={kind} toolRow={toolRow} />
      {liveToolRow ? <MobileNativeChatToolDetailSheet pair={detailPair} onClose={() => setDetailPair(null)} /> : null}
    </View>
  )
}
