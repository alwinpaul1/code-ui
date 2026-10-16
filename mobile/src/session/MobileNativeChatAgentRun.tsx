import { useMemo } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { claudeToolRunPalette } from '../theme/claude-tool-run-palette'
import { useTheme } from '../theme/theme-context'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import { agentRunState, runningAgentText } from './mobile-native-chat-agent-run'
import { TOOL_RUN_ROW } from './claude-tool-run-row-spec'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { ShimmerText } from './MobileNativeChatShimmerText'
import { useNativeChatAgentRuns, useRunSheetOpener } from './native-chat-tasks-context'

/**
 * A run of Agent calls, drawn the way the Claude app draws it: a bare "Running
 * agent ›" with no icon while a call is still being made (the user's
 * screenshot, 2026-10-16), "Running agent: <description> ›" beside the agent
 * icon while an agent it launched runs in the background, "Ran 5 agents ›"
 * once nothing runs, and a sheet of "Ran agent <description>" rows behind the
 * tap (2026-09-24, Claude Code 2.1.281). The decompiled rule is in
 * mobile-native-chat-agent-run.ts. While it runs the icon and the chevron
 * stand still and a band sweeps across the label, as in the user's recording
 * of the Claude app (2026-09-26).
 */
export function MobileNativeChatAgentRun({
  blocks,
  revertScope,
  styles
}: {
  blocks: readonly NativeChatBlock[]
  /** The run's place in its message; names its sheet's owner. */
  revertScope?: string
  styles: ChatMessageStyles
}) {
  const { scheme } = useTheme()
  const toolRun = claudeToolRunPalette(scheme)
  const runs = useNativeChatAgentRuns()
  const openRunSheet = useRunSheetOpener(blocks, revertScope)
  const { running, entries, subject, icon } = useMemo(() => agentRunState(blocks, runs), [blocks, runs])
  const label = running
    ? runningAgentText(subject)
    : `Ran ${entries.length} agent${entries.length === 1 ? '' : 's'}`
  return (
    <View style={styles.toolRun}>
      <View style={styles.toolRunHeader}>
        <Pressable
          style={styles.toolRunToggle}
          onPress={openRunSheet}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Show the agents`}
          accessibilityLiveRegion="polite"
        >
          {running && icon ? <AgentRunGlyph icon={icon} color={toolRun.icon} /> : null}
          <ShimmerText
            text={label}
            active={running}
            color={toolRun.text}
            style={[styles.toolRunLabel, { flex: 0, flexShrink: 1 }]}
            numberOfLines={1}
            testID="agent-run-label"
          />
          <ChevronRight size={TOOL_RUN_ROW.chevronSize} color={toolRun.text} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  )
}
