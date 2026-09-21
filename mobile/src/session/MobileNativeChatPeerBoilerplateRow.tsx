import { View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { Prose } from './MobileNativeChatProse'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

/**
 * The harness's words around a peer message, drawn the way the Claude app
 * draws that turn: a user bubble, before the reply. A system row on purpose
 * (a user row is "the person's prompt" to rewind, echo and queue logic), so
 * it gets the bubble's look and none of a prompt's controls: no hold-to-copy,
 * no rewind, nothing to disclose (mobile-native-chat-peer-messages.ts).
 */
export function MobileNativeChatPeerBoilerplateRow({
  message,
  fontScale,
  styles
}: {
  message: NativeChatMessage
  fontScale: number
  styles: ChatMessageStyles
}) {
  const block = message.blocks[0]
  if (!block) {
    return null
  }
  return (
    <View style={[styles.row, styles.rowUser]}>
      <View
        style={[styles.content, styles.userBubble]}
        accessibilityLabel="Injected by Claude Code"
        testID="native-chat-peer-boilerplate"
      >
        <Prose block={block} invert fontScale={fontScale} styles={styles} />
      </View>
    </View>
  )
}
