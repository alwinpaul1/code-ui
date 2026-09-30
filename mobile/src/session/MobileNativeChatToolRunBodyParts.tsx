import { Pressable, Text, View } from 'react-native'
import type { NativeChatDiffLine as DiffLine } from '../../../src/shared/native-chat-diff'
import { truncateToolDetail } from '../../../src/shared/native-chat-tool-summary'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

// Pieces of a tool run's body (MobileNativeChatToolRun.tsx), kept apart so
// that file stays under its line cap.

export function DiffView({ lines, styles }: { lines: DiffLine[]; styles: ChatMessageStyles }) {
  return (
    <View style={styles.diff}>
      {lines.map((line, i) => (
        <Text
          key={i}
          style={[
            styles.diffLine,
            line.kind === 'add' && styles.diffAdd,
            line.kind === 'del' && styles.diffDel,
            line.kind === 'meta' && styles.diffMeta
          ]}
        >
          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          {line.text}
        </Text>
      ))}
    </View>
  )
}

export function ResultBody({
  output,
  isError,
  diff,
  styles
}: {
  output: string
  isError?: boolean
  diff: DiffLine[] | null
  styles: ChatMessageStyles
}) {
  if (diff) {
    return <DiffView lines={diff} styles={styles} />
  }
  return (
    <View style={[styles.toolResult, isError && styles.toolResultError]}>
      <Text style={styles.mono}>{truncateToolDetail(output)}</Text>
    </View>
  )
}

/** The button that stands in for a run's calls past the first six. */
export function ShowMoreCalls({
  count,
  onPress,
  styles
}: {
  count: number
  onPress: () => void
  styles: ChatMessageStyles
}): React.JSX.Element {
  const label = `Show ${count} more tool call${count === 1 ? '' : 's'}`
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[styles.toolPreview, styles.toolPreviewLink]}>{label}</Text>
    </Pressable>
  )
}
