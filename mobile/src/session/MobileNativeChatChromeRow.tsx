import { Pressable, View } from 'react-native'
import { Square } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'

/** Chrome row above the composer: the status line (what the agent is doing,
 *  how many tasks run) on the left, Stop in the far corner, and the send-failure
 *  banner beneath. It draws nothing, and takes no height, when all three are
 *  absent. (Expanding tool calls is a Settings switch, not a control here.) */
export function MobileNativeChatChromeRow({
  agentWorking,
  canStop,
  showWorkingIndicator = true,
  spinner = null,
  onStop,
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
  /** The agent's own spinner line, read off its screen, when one is up. */
  spinner?: ClaudeSpinner | null
  onStop?: () => void
  sendErrorMessage?: string | null
  styles: ChatViewStyles
}) {
  const { colors } = useTheme()
  return (
    <>
      {/* Empty stretches of this row pass touches through to the list beneath
          (see the dock in MobileNativeChatView); Stop keeps its own. */}
      <View style={styles.chromeRow} pointerEvents="box-none">
        <View style={styles.chromeLeft} pointerEvents="box-none">
          <MobileNativeChatStatusLine working={agentWorking === true && showWorkingIndicator} spinner={spinner} />
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
          pointerEvents="box-none"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <View style={styles.sendErrorPill}>
            <Txt variant="caption" weight="semibold" tone="danger">
              {sendErrorMessage}
            </Txt>
          </View>
        </View>
      ) : null}
    </>
  )
}
