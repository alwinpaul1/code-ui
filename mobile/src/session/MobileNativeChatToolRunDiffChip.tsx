import { Text } from 'react-native'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import type { NativeChatToolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'

/** docs/claude-app-parity.md item 3: the run header's own green/red "+A −R"
 *  line-count chip, beside a run that created or edited a file — the same
 *  diff tokens `MobileNativeChatDiffCard`'s header uses, so the two read as
 *  one system. */
export function ToolRunDiffChip({
  stat,
  styles
}: {
  stat: NativeChatToolRunDiffStat
  styles: ChatMessageStyles
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <>
      <Text
        testID="tool-run-diff-added"
        style={{ ...styles.toolMetaText, color: colors.diffAddText }}
      >
        {`+${stat.added}`}
      </Text>
      <Text
        testID="tool-run-diff-removed"
        style={{ ...styles.toolMetaText, color: colors.diffDelText }}
      >
        {`−${stat.removed}`}
      </Text>
    </>
  )
}
