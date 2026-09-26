import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import type { NativeChatToolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'

const pill = StyleSheet.create({
  // Never shrinks: on a narrow row the sentence before it ellipsizes instead.
  pill: {
    flexDirection: 'row',
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 6
  },
  // As tight as the inline code pills (mobile-markdown-styles.ts).
  segment: {
    paddingHorizontal: 5,
    paddingVertical: 1
  }
})

/** docs/claude-app-parity.md item 3: the run header's "+A −R" line count, as
 *  the Claude app draws it (2026-09-26): one rounded pill, green "+A" on a
 *  green tint joined to red "−R" on a red tint, right after the sentence, in
 *  the sentence's own type. The same diff tokens `MobileNativeChatDiffCard`'s
 *  header uses, so the two read as one system. "+0 −0" is still a whole pill. */
export function ToolRunDiffChip({
  stat,
  styles
}: {
  stat: NativeChatToolRunDiffStat
  styles: ChatMessageStyles
}): React.JSX.Element {
  const { colors } = useTheme()
  const type = { fontFamily: styles.toolRunLabel.fontFamily, fontSize: styles.toolRunLabel.fontSize }
  return (
    <View testID="tool-run-diff-chip" style={pill.pill}>
      <Text
        testID="tool-run-diff-added"
        style={[pill.segment, type, { color: colors.diffAddText, backgroundColor: colors.diffAddBg }]}
      >
        {`+${stat.added}`}
      </Text>
      <Text
        testID="tool-run-diff-removed"
        style={[pill.segment, type, { color: colors.diffDelText, backgroundColor: colors.diffDelBg }]}
      >
        {`−${stat.removed}`}
      </Text>
    </View>
  )
}
