import { useMemo } from 'react'
import { View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { useClaudeChatLive } from './claude-chat-live'
import { workingMarkKindFromTranscript } from './claude-working-mark-kind'

/**
 * The working line as the transcript's last row, as the Claude app's "thinking_spark" item is
 * (`y07` case 15, com.anthropic.claude 1.261013.20): it scrolls with the messages. Pinned in the
 * see-through dock it lay over them once the list scrolled ("4 running tasks" drawn across a
 * paragraph on the user's phone, 0.9.154). MobileNativeChatView puts it first in the inverted
 * list's header, so it sits under the newest message and above a queued one, as in the app.
 *
 * The mark follows the turn's running tool (claude-working-mark-kind.ts); Anthropic's stream says
 * whether the turn is thinking when it is live, the bridge lane's own flag otherwise.
 */
export function MobileNativeChatWorkingFooter({
  messages,
  working,
  thinking
}: {
  messages: readonly NativeChatMessage[]
  /** False on the structured lane, which says "Working for N" per turn: there only the count shows. */
  working: boolean
  thinking: boolean
}) {
  const liveThinking = useClaudeChatLive()?.footer?.thinking
  const markKind = useMemo(
    () => workingMarkKindFromTranscript(messages, liveThinking ?? thinking),
    [messages, liveThinking, thinking]
  )
  return (
    <View testID="native-chat-working-footer">
      <MobileNativeChatStatusLine working={working} markKind={markKind} />
    </View>
  )
}
