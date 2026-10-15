import { Pressable, View } from 'react-native'
import { Txt } from '../ui/Txt'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'
import { useSendErrorRetryable } from './native-chat-send-error-retry'

/** Chrome above the composer: the send-failure banner. It draws nothing, and takes no height,
 *  when there is no failure. The working line ("Clauding... · 2 running tasks") is not here: it
 *  is the transcript list's last row, as in the Claude app, so it scrolls with the messages
 *  instead of lying over them (MobileNativeChatView, 2026-10-15). Stop is not here either: it
 *  takes the composer's send slot (MobileNativeChatComposer.tsx). */
export function MobileNativeChatChromeRow({
  sendErrorMessage,
  onRetrySend,
  styles
}: {
  sendErrorMessage?: string | null
  /** Sends the composer's words again; drawn only while the banner's failure offers Retry. */
  onRetrySend?: () => void
  styles: ChatViewStyles
}) {
  const retryable = useSendErrorRetryable(sendErrorMessage) && onRetrySend !== undefined
  return (
    <>
      {sendErrorMessage ? (
        // This banner is the only channel for a send failure — announce it.
        <View
          style={styles.sendError}
          pointerEvents="box-none"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <View style={[styles.sendErrorPill, retryable && styles.sendErrorPillWithAction]}>
            <Txt variant="caption" weight="semibold" tone="danger" style={retryable ? styles.sendErrorText : undefined}>
              {sendErrorMessage}
            </Txt>
            {retryable ? (
              // S5: a send refused before anything was written, its words back in the
              // composer, offers Retry, as the Claude app's snackbar does.
              <Pressable
                onPress={onRetrySend}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Retry sending the message"
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Txt variant="caption" weight="bold" tone="danger" style={styles.sendErrorAction}>
                  Retry
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  )
}
