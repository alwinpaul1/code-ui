import { useMemo } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import { agentRunState, runningAgentText } from './mobile-native-chat-agent-run'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { ShimmerText } from './MobileNativeChatShimmerText'
import { useNativeChatAgentRuns, useRunSheetOpener } from './native-chat-tasks-context'

/**
 * A run of Agent calls, drawn the way the Claude app draws it: "Running agent:
 * Review: story flow ›" (the agent it names) while any of them still runs, "Ran 5 agents ›" once all have reported, and a
 * sheet of "Ran agent <description>" rows behind the tap (2026-09-24,
 * Claude Code 2.1.281). Running comes from the background-task reader, not
 * from the run: a background launch answers at once. While it runs the
 * diamonds and the chevron stand still and a band sweeps across the label, as
 * in the user's recording of the Claude app (2026-09-26).
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
  const { colors } = useTheme()
  const runs = useNativeChatAgentRuns()
  const openRunSheet = useRunSheetOpener(blocks, revertScope)
  const { running, entries, subject } = useMemo(() => agentRunState(blocks, runs), [blocks, runs])
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
          <AgentRunGlyph color={colors.textMuted} />
          <ShimmerText
            text={label}
            active={running}
            color={colors.textSecondary}
            style={[styles.toolRunLabel, { flex: 0, flexShrink: 1 }]}
            numberOfLines={1}
            testID="agent-run-label"
          />
          <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  )
}
