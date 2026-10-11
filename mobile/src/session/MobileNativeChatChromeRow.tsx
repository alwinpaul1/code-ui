import { View } from 'react-native'
import { Txt } from '../ui/Txt'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'

/** Chrome row above the composer: the status line (what the agent is doing,
 *  how many tasks run) and the send-failure banner beneath. It draws nothing,
 *  and takes no height, when both are absent. Stop is not here: it takes the
 *  composer's send slot, as in the Claude app (MobileNativeChatComposer.tsx).
 *  (Expanding tool calls is a Settings switch, not a control here.) */
export function MobileNativeChatChromeRow({
  agentWorking,
  showWorkingIndicator = true,
  spinner = null,
  sendErrorMessage,
  styles
}: {
  agentWorking?: boolean
  /** False on the structured lane, whose per-turn status row already says the
   *  agent is working — a second static row would report it twice. */
  showWorkingIndicator?: boolean
  /** The agent's own spinner line, read off its screen, when one is up. */
  spinner?: ClaudeSpinner | null
  sendErrorMessage?: string | null
  styles: ChatViewStyles
}) {
  return (
    <>
      {/* The row passes touches through to the list beneath (see the dock in
          MobileNativeChatView). */}
      <View style={styles.chromeRow} pointerEvents="box-none">
        <View style={styles.chromeLeft} pointerEvents="box-none">
          <MobileNativeChatStatusLine working={agentWorking === true && showWorkingIndicator} spinner={spinner} />
        </View>
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
