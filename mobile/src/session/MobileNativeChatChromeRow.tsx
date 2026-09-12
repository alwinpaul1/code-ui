import { Pressable, View } from 'react-native'
import { ChevronsDownUp, ChevronsUpDown, Square } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'

/** Chrome row above the composer: the working indicator and the global
 *  tool-calls expand/collapse toggle on the left, Stop in the far corner, and
 *  the send-failure banner beneath. */
export function MobileNativeChatChromeRow({
  agentWorking,
  canStop,
  showWorkingIndicator = true,
  onStop,
  toolsExpanded,
  onToggleTools,
  sendErrorMessage,
  styles
}: {
  agentWorking?: boolean
  /** Whether Stop has a turn to act on; defaults to `agentWorking`. On the
   *  structured lane the row says "working" from the journalled send, and the
   *  provider may not have opened a turn yet — a Stop offered then would be a
   *  button that cannot do anything. */
  canStop?: boolean
  /** False on the structured lane, whose per-turn status row already says the
   *  agent is working — a second static row would report it twice. */
  showWorkingIndicator?: boolean
  onStop?: () => void
  toolsExpanded: boolean
  onToggleTools: () => void
  sendErrorMessage?: string | null
  styles: ChatViewStyles
}) {
  const { colors } = useTheme()
  return (
    <>
      <View style={styles.chromeRow}>
        <View style={styles.chromeLeft}>
          {agentWorking && showWorkingIndicator ? <MobileAgentWorkingIndicator /> : null}
          <Pressable
            style={({ pressed }) => [styles.chromeToggle, pressed && styles.pressed]}
            onPress={onToggleTools}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={toolsExpanded ? 'Collapse tool calls' : 'Expand tool calls'}
          >
            {toolsExpanded ? (
              <ChevronsDownUp size={14} color={colors.textMuted} strokeWidth={2} />
            ) : (
              <ChevronsUpDown size={14} color={colors.textMuted} strokeWidth={2} />
            )}
            <Txt variant="caption" weight="semibold" tone="muted">
              {toolsExpanded ? 'Collapse' : 'Tools'}
            </Txt>
          </Pressable>
        </View>
        {(canStop ?? agentWorking) ? (
          <Pressable
            style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
            onPress={onStop}
            hitSlop={8}
            accessibilityLabel="Stop the agent"
          >
            <Square size={11} color={colors.danger} strokeWidth={2.4} fill={colors.danger} />
            <Txt variant="caption" weight="bold" tone="danger">
              Stop
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {sendErrorMessage ? (
        // This banner is the only channel for a send failure — announce it.
        <View
          style={styles.sendError}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Txt variant="caption" weight="semibold" tone="danger">
            {sendErrorMessage}
          </Txt>
        </View>
      ) : null}
    </>
  )
}
