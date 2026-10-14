import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { MobileBackgroundTasksPulse } from './MobileBackgroundTasksPulse'
import { nativeChatConnectionNotice, type NativeChatConnectionNotice } from './native-chat-connection-notice'
import type { MobileSessionController } from './use-mobile-session-controller'

// The Claude app's connection row (com.anthropic.claude 1.261009.20, `nl7.b` drawing `au8`'s message).
// A row 16 dp above and below (`rrb.Q(.., 0, 16)`), the 16 dp clay mark, an 8 dp gap (`ixv.u(8)`), the
// message at `jn7.E` 15/400/1.4 in `pl7.e` (`nl7.d`: one line here, `maxLines` 1). The mark is drawn
// animated whenever a message is (`nl7.b` passes the busy flag to it for every message state).
//
// Code UI's tokens stand in where the app's have no match: the clay `pl7.e` (#C6613F light, #D97757
// dark) is `composerSend`, the same value; the mark is Code UI's own starburst
// (MobileBackgroundTasksPulse), 15 dp where the app's sprite is 16. The row's side padding is the
// dock's (`space.md`), where the app's parent supplies its own.
//
// It stands beside the status line's "Working", which is Batch 1's row and is left as it is: while a
// turn runs and the connection is down, the line above the composer says both "Working" and why that
// may be out of date.

const ROW_PADDING_Y = 16
const MARK_GAP = 8

/** The row, from its notice. Pure of the connection: the connected row below feeds it, and the tests
 *  drive it in light and dark. */
export function ConnectionRowView({ notice }: { notice: NativeChatConnectionNotice }): React.JSX.Element {
  const { colors, space } = useTheme()
  return (
    <View
      testID="chat-connection-row"
      accessibilityLiveRegion="polite"
      accessibilityLabel={notice.text}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: ROW_PADDING_Y,
        paddingHorizontal: space.md,
        gap: MARK_GAP
      }}
    >
      <MobileBackgroundTasksPulse color={colors.composerSend} breathing />
      <Txt variant="body" numberOfLines={1} style={{ flexShrink: 1, color: colors.composerSend }}>
        {notice.text}
      </Txt>
    </View>
  )
}

export function MobileNativeChatConnectionRow({
  controller
}: {
  controller: MobileSessionController
}): React.JSX.Element | null {
  const notice = nativeChatConnectionNotice({
    connState: controller.connState,
    verdict: controller.connectionVerdict.kind,
    agentWorking: controller.nativeChatController.nativeChatAgentWorking === true
  })
  return notice === null ? null : <ConnectionRowView notice={notice} />
}
