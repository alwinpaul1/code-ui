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
    borderRadius: 5
  },
  // Tighter than an inline code pill: a tag beside the sentence, not a second line of it (the
  // user, 2026-09-28: "reduce the size of lines written and number of lines removed pill").
  segment: {
    paddingHorizontal: 4,
    paddingVertical: 0
  }
})

/** The pill's type against the sentence it follows: a step down, so it reads as a tag. */
const DIFF_PILL_TYPE_SCALE = 0.85

/** docs/claude-app-parity.md item 3: the run header's "+A −R" line count, as
 *  the Claude app draws it (2026-09-26): one rounded pill, green "+A" on a
 *  green tint joined to red "−R" on a red tint, right after the sentence, a
 *  step smaller than the sentence's own type. The same diff tokens `MobileNativeChatDiffCard`'s
 *  header uses, so the two read as one system. "+0 −0" is still a whole pill. */
export function ToolRunDiffChip({
  stat,
  styles
}: {
  stat: NativeChatToolRunDiffStat
  styles: ChatMessageStyles
}): React.JSX.Element {
  const sentenceSize = styles.toolRunLabel.fontSize ?? 13
  return (
    <DiffPill
      stat={stat}
      fontFamily={styles.toolRunLabel.fontFamily}
      fontSize={Math.round(sentenceSize * DIFF_PILL_TYPE_SCALE)}
    />
  )
}

/** The pill itself, at the type size and face its caller sets: the run sheet's
 *  file rows draw it beside a file name, as the Claude app does. */
export function DiffPill({
  stat,
  fontFamily,
  fontSize
}: {
  stat: NativeChatToolRunDiffStat
  fontFamily: string | undefined
  fontSize: number
}): React.JSX.Element {
  const { colors } = useTheme()
  const type = { fontFamily, fontSize }
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
