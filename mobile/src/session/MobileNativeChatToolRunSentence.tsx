import { Text, type TextStyle, type StyleProp } from 'react-native'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import type { ToolRunSentenceSpan } from './mobile-native-chat-tool-sentence'

/** A finished run's one-line sentence, or `fallback` when it has none. A
 *  SendMessage's addressee is its own span in the member-name tone, the mark
 *  a batch row already uses between a name and its argument, so a spaced
 *  name shows where it ends and the preview begins. */
export function ToolRunSentenceText({
  spans,
  fallback,
  style,
  styles
}: {
  spans: readonly ToolRunSentenceSpan[]
  fallback: string
  style: StyleProp<TextStyle>
  styles: ChatMessageStyles
}): React.JSX.Element {
  const plain = spans.every((span) => !span.recipient)
  return (
    <Text style={style} numberOfLines={1} testID="tool-run-sentence">
      {spans.length === 0
        ? fallback
        : plain
          ? spans.map((span) => span.text).join('')
          : spans.map((span, index) =>
              span.recipient ? (
                <Text key={index} style={styles.toolRunMemberName}>
                  {span.text}
                </Text>
              ) : (
                span.text
              )
            )}
    </Text>
  )
}
