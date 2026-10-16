import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
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
 *  step smaller than the sentence's own type. Text and tint are the Claude app's `ra20.a`
 *  (`ad5.J()` on `ad5.f0()`, `ad5.h()` on `ad5.s()`, claude-session-pill-palette.ts), the same in
 *  the file rows of the run sheet. "+0 −0" is still a whole pill. */
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
      style={styles.toolRunDiffStat}
    />
  )
}

/** The pill itself, at the type size and face its caller sets: the run sheet's
 *  file rows draw it beside a file name, as the Claude app does. */
export function DiffPill({
  stat,
  fontFamily,
  fontSize,
  style
}: {
  stat: NativeChatToolRunDiffStat
  fontFamily: string | undefined
  fontSize: number
  /** Its place in the caller's row (the run header's 8 dp after the sentence). */
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const { scheme } = useTheme()
  const claude = claudeSessionPillPalette(scheme)
  const type = { fontFamily, fontSize }
  return (
    <View testID="tool-run-diff-chip" style={[pill.pill, style]}>
      <Text
        testID="tool-run-diff-added"
        style={[pill.segment, type, { color: claude.chipAddText, backgroundColor: claude.chipAddFill }]}
      >
        {`+${stat.added}`}
      </Text>
      <Text
        testID="tool-run-diff-removed"
        style={[pill.segment, type, { color: claude.chipDelText, backgroundColor: claude.chipDelFill }]}
      >
        {`−${stat.removed}`}
      </Text>
    </View>
  )
}
