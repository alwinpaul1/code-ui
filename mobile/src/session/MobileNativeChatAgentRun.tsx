import { useMemo, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import { agentRunState } from './mobile-native-chat-agent-run'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { ShimmerText } from './MobileNativeChatShimmerText'
import { useNativeChatAgentRuns } from './native-chat-tasks-context'

/**
 * A run of Agent calls, drawn the way the Claude app draws it: "Running agent ›"
 * while any of them still runs, "Ran 5 agents ›" once all have reported, and a
 * sheet of "Ran agent <description>" rows behind the tap (2026-09-24,
 * Claude Code 2.1.281). Running comes from the background-task reader, not
 * from the run: a background launch answers at once. While it runs the
 * diamonds and the chevron stand still and a band sweeps across the label, as
 * in the user's recording of the Claude app (2026-09-26).
 */
export function MobileNativeChatAgentRun({
  blocks,
  trailing,
  styles
}: {
  blocks: readonly NativeChatBlock[]
  trailing?: ReactNode
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const runs = useNativeChatAgentRuns()
  const { running, entries } = useMemo(() => agentRunState(blocks, runs), [blocks, runs])
  const label = running
    ? 'Running agent'
    : `Ran ${entries.length} agent${entries.length === 1 ? '' : 's'}`
  return (
    <View style={styles.toolRun}>
      <View style={styles.toolRunHeader}>
        <Pressable
          style={styles.toolRunToggle}
          onPress={() => runs.openRun?.(blocks)}
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
            style={[styles.toolRunLabel, { flex: 0 }]}
            numberOfLines={1}
            testID="agent-run-label"
          />
          <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
        {trailing}
      </View>
    </View>
  )
}
