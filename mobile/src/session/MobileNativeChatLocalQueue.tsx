import { Pressable, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'

// The app's own "x": U+E10F of its icon font (com.anthropic.claude 1.261013.20,
// assets/cds_icon_symbols.ttf, 1000 units to the em, read with fontTools 2026-10-16). Symmetric
// about y = 500, so the font's y-up outline draws the same in SVG's y-down box.
const X_OUTLINE =
  'M705 745Q713 753 725 753Q737 753 745 745Q753 737 753 725Q753 713 745 705L295 255Q287 247 275 247Q263 247 255 255Q247 263 247 275Q247 287 255 295ZM745 295Q753 287 753 275Q753 263 745 255Q737 247 725 247Q713 247 705 255L255 705Q247 713 247 725Q247 737 255 745Q263 753 275 753Q287 753 295 745Z'
const PADDING = 12
const X_SIZE = 14
/** The words' end padding in the app: the 14 dp "x" and 8 dp of air. */
const WORDS_END_PADDING = 22

/** The app's `ccr_queued_message_dismiss`. */
export const QUEUED_MESSAGE_EDIT_LABEL = 'Edit queued message'

/**
 * The messages queued while Claude works, on a Claude tab that sends through Anthropic
 * (use-ccr-composer-send.ts): ONE card per queued message, oldest first, each drawn as the Claude
 * Android app 1.261009.20 draws its queued card (`hb20.e`): 80% of the width, aligned like a user
 * message, a 12 dp radius on fill `pl7.s`, 12 dp padding, the words at 15 sp italic in the muted
 * `pl7.Q`, and a 14 dp "x" at the top end ("Edit queued message"). A tap anywhere on a card moves
 * THAT message back into the composer (ahead of any draft) and leaves the others queued; there is
 * no separate delete. The first card sits 20 dp below what is above it, as the app's one card
 * does; each card keeps the app's 8 dp under it, which is the gap between two.
 *
 * The app's own local queue is one string drawn as one card; a card per message is what the user
 * sees in the app when each send is kept separate (ccr-local-queue.ts says why the phone does
 * that). Reported 2026-10-16: two sends drew as one card here.
 *
 * Built as the app builds its card (1.261013.20 `ti30`): a box, the words with a 22 dp end
 * padding, and the "x" laid over them at TopEnd, so it sits 12 dp from the card's top and end
 * edges however the words wrap.
 *
 * `pl7.s` (#F0EFEC light, #0D0D0D dark) is the theme's `codeBlockHeader` and `pl7.Q` (#7B7974,
 * #97958D) its `composerPlaceholder`: the same app tokens, read from the theme so Light, Dark and
 * System all follow it. No literal colour here.
 */
export function MobileNativeChatLocalQueue({ entries, onEdit }: { entries: readonly string[]; onEdit: (index: number) => void }): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <>
      {entries.map((text, index) => (
        // Two identical messages are two entries: the position is the identity.
        <QueuedCard key={index} text={text} first={index === 0} onEdit={() => onEdit(index)} />
      ))}
    </>
  )
}

function QueuedCard({ text, first, onEdit }: { text: string; first: boolean; onEdit: () => void }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={QUEUED_MESSAGE_EDIT_LABEL}
      accessibilityHint="Moves it back into the message box"
      onPress={onEdit}
      testID="ccr-queued-message"
      style={{
        alignSelf: 'flex-end',
        width: '80%',
        marginTop: first ? 20 : 0,
        marginHorizontal: 16,
        marginBottom: 8,
        padding: PADDING,
        borderRadius: 12,
        backgroundColor: colors.codeBlockHeader
      }}
    >
      <Txt
        variant="body"
        style={{ fontStyle: 'italic', color: colors.composerPlaceholder, paddingRight: WORDS_END_PADDING }}
      >
        {text}
      </Txt>
      <View
        testID="ccr-queued-message-x"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: PADDING, right: PADDING, width: X_SIZE, height: X_SIZE }}
      >
        <Svg width={X_SIZE} height={X_SIZE} viewBox="0 0 1000 1000">
          <Path d={X_OUTLINE} fill={colors.composerPlaceholder} />
        </Svg>
      </View>
    </Pressable>
  )
}
