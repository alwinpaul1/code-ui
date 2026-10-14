import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { CodeCopyGlyph } from '../components/MobileMarkdownCodeIconButton'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { trailingWorkIsRunning } from './mobile-native-chat-turn-end'
import { useNativeChatAgentRuns } from './native-chat-tasks-context'

// A reply's actions (Copy) and where a row draws them. Their place follows the
// Claude app's action row (l330.a): under the turn's last words while work
// after them runs, under the turn's end once it is over.

/** The Copy glyph's size in dp, fixed: 14. The Claude app's is 20 sp and follows the system font;
 *  the user asked for this one back (2026-10-11). */
const COPY_GLYPH_DP = 14
/** The Claude app's touch target for its action buttons (`bf4`, `cf4.d()`). */
const ACTION_TOUCH_TARGET_DP = 40

/** Subtle controls under the end of an agent turn: copy the reply's prose. No
 *  Copy without prose to copy: under a message made only of tool calls a tap
 *  copied nothing and said nothing, a dead button (review, 2026-09-30).
 *
 *  No scroll-to-the-reply's-start arrow: the Claude app has none, under a
 *  finished reply or a working turn (user, 2026-10-11, with a screenshot of
 *  Claude: copy and read-aloud only). Ours blinked the jump control when tapped
 *  under a working turn and, with replies a background task started read as one
 *  turn, landed several replies up.
 *
 *  A 14 icon in a padding of 4 (controlButton). Claude's own buttons are larger
 *  (bf4 "Small": a 20 icon in a 36 box); the user kept this size after trying
 *  Claude's (2026-10-11), so only what does not change the look is Claude's:
 *  the glyph rests in `pl7.Q` (composerPlaceholder), becomes a check tinted
 *  `ad5.K()` (codeBlockCopied) over 300 ms once the text is on the clipboard,
 *  goes back after 2000 ms (fa20.a, the composable the code block's Copy is too),
 *  and the touch target reaches 40 dp. */
export function AgentControls({
  onCopy,
  copied,
  styles
}: {
  onCopy: () => void
  /** The clipboard took the text and the check is showing. */
  copied: boolean
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  // The padded button grown to the 40 dp target by the slop, on each side.
  const box = COPY_GLYPH_DP + styles.controlButton.padding * 2
  const hitSlop = Math.max(0, Math.ceil((ACTION_TOUCH_TARGET_DP - box) / 2))
  return (
    <View style={styles.controls}>
      <Pressable
        style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        onPress={onCopy}
        hitSlop={hitSlop}
        accessibilityLabel="Copy message"
      >
        <CodeCopyGlyph
          copied={copied}
          sizeDp={COPY_GLYPH_DP}
          color={colors.composerPlaceholder}
          copiedColor={colors.codeBlockCopied}
        />
      </Pressable>
    </View>
  )
}

export type TurnActionsAt = 'words' | 'end'

/** Which of a row's two places draws its turn's actions, if either: under
 *  the last words while the work after them runs, else the turn's end. A turn
 *  with no words and running work draws none, as Claude's has nothing to hang
 *  them on yet. */
function turnActionsPlace({
  workRuns,
  hasWordsPlace,
  endsTurn
}: {
  workRuns: boolean
  hasWordsPlace: boolean
  endsTurn: boolean
}): TurnActionsAt | null {
  if (workRuns) {
    return hasWordsPlace ? 'words' : null
  }
  return endsTurn ? 'end' : null
}

/** One of the two places a row may draw its turn's actions. It, not the row,
 *  reads the background work: that context changes with every transcript
 *  update, and a row reading it re-rendered on every tick (review of
 *  b935e72a7). Both places read the same inputs, so they agree. */
export function TurnActionsPlace({
  at,
  controls,
  work,
  turnIsNewest,
  endsTurn,
  hasWordsPlace,
  styles
}: {
  at: TurnActionsAt
  controls: ReactNode
  work: readonly NativeChatBlock[]
  turnIsNewest: boolean
  endsTurn: boolean
  hasWordsPlace: boolean
  styles: ChatMessageStyles
}) {
  const runs = useNativeChatAgentRuns()
  const workRuns = trailingWorkIsRunning(work, { turnIsNewest, runs })
  if (!controls || turnActionsPlace({ workRuns, hasWordsPlace, endsTurn }) !== at) {
    return null
  }
  return <View style={styles.agentControlsRow}>{controls}</View>
}
