import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { claudeArtifactCardPalette } from '../theme/claude-artifact-card-palette'
import { claudeToolRunPalette } from '../theme/claude-tool-run-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { ArtifactCallView } from './claude-artifacts'
import { useClaudeArtifactAccount } from './claude-artifact-account-context'
import { useClaudeArtifactList } from './claude-artifact-list-store'
import { ClaudeArtifactsGlyph } from './ClaudeArtifactsGlyph'
import { TOOL_RUN_ROW } from './claude-tool-run-row-spec'
import { artifactCardContent } from './mobile-native-chat-artifact-segment'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { useRunSheetOpener } from './native-chat-tasks-context'
import { openClaudeArtifact } from './open-claude-artifact'

// The Claude app's card (1.261013.20, kv30.a → bs30.d, the component its file cards use), in dp:
// the content row is padded 12 at each side (`oxb.I(…, 12, 0)`, b8o(start, top, end, bottom) =
// (12, 0, 12, 0)); the tile is 56 × 72 inside a padding of 12 at each side as well, shifted 15 down
// (`yg7.z(…, 0, 15)`) so the card's bottom edge cuts it, a page peeking out; its glyph is centred
// in what shows, a bottom padding of 15 (`oxb.K(…, 0, 0, 0, 15)`); a 12 spacer (`ozl.z(…, 12)`)
// before the words, which take the rest of the row with 12 above and below and 8 between title and
// subtitle; the spinner is 20 with a 2 stroke (`szp.a(pmw.p(20), …, 2.0f)`) in a 32 box.
const CARD_RADIUS = 12
const ROW_PADDING = 12
const TILE_WIDTH = 56
const TILE_HEIGHT = 72
const TILE_MARGIN = 12
const TILE_SHIFT = 15
const TILE_RADIUS = 8
const GLYPH_SIZE = 24
const WORDS_GAP = 12
const WORDS_PADDING_VERTICAL = 12
const SUBTITLE_GAP = 8
const SPINNER_BOX = 32
const SPINNER_SIZE = 20

type CardView = Exclude<ArtifactCallView, { kind: 'row' }>

/**
 * One Artifact call, drawn as the Claude app draws it (a18.java:56-190): a card while it publishes
 * or opens a page and once it has, a plain tool row naming the error when it failed. The segment
 * is the call and its answer alone (mobile-native-chat-turn-segments.ts stands it apart).
 */
export function MobileNativeChatArtifactSegment({
  view,
  blocks,
  revertScope,
  styles
}: {
  view: CardView
  blocks: readonly NativeChatBlock[]
  revertScope?: string
  styles: ChatMessageStyles
}) {
  if (view.kind === 'failed') {
    return <ArtifactFailedRow message={view.message} blocks={blocks} revertScope={revertScope} styles={styles} />
  }
  return <ArtifactCard view={view} />
}

function ArtifactCard({ view }: { view: Exclude<CardView, { kind: 'failed' }> }) {
  const { scheme, colors } = useTheme()
  const palette = claudeArtifactCardPalette(scheme)
  // The page's own title is the account list's; only a published page has one to look up, and
  // with no account known nothing is read.
  const account = useClaudeArtifactAccount()
  const list = useClaudeArtifactList(view.kind === 'published' ? account : null)
  const listTitle = view.kind === 'published' ? (list.items.find((item) => item.uuid === view.link.uuid)?.title ?? null) : null
  const content = artifactCardContent(view, listTitle)
  const cardStyle = [cardStyles.card, { backgroundColor: palette.cardFill, borderColor: colors.border }]
  const body = (
    <View style={cardStyles.row}>
      <View
        testID="artifact-card-tile"
        style={[cardStyles.tile, { backgroundColor: palette.tileFill, borderColor: palette.tileBorder }]}
      >
        <ClaudeArtifactsGlyph size={GLYPH_SIZE} color={palette.icon} testID="artifact-card-glyph" />
      </View>
      <View style={cardStyles.words}>
        <Txt variant="body" weight="bold" numberOfLines={2} testID="artifact-card-title">
          {content.title}
        </Txt>
        {content.subtitle ? (
          <Txt variant="body" tone="secondary" numberOfLines={1} style={cardStyles.subtitle} testID="artifact-card-subtitle">
            {content.subtitle}
          </Txt>
        ) : null}
      </View>
      {content.busy ? (
        <View style={cardStyles.spinnerBox}>
          <ActivityIndicator size={SPINNER_SIZE} color={colors.textSecondary} testID="artifact-card-spinner" />
        </View>
      ) : null}
    </View>
  )
  if (view.kind === 'published') {
    const { link } = view
    return (
      <Pressable
        testID="artifact-card"
        style={({ pressed }) => [cardStyle, pressed ? cardStyles.pressed : null]}
        onPress={() => openClaudeArtifact(account ? { url: link.url, title: content.title, accountId: account } : { url: link.url, title: content.title })}
        accessibilityRole="button"
        accessibilityLabel={content.accessibilityLabel}
      >
        {body}
      </Pressable>
    )
  }
  return (
    <View
      testID="artifact-card"
      style={cardStyle}
      accessible
      accessibilityLabel={content.accessibilityLabel}
      accessibilityLiveRegion="polite"
    >
      {body}
    </View>
  )
}

/** a18's failure branch: `tw30.n` with the error's words, the generic step row. A tap opens the
 *  run's sheet, as any other step row's does, where the whole error reads. */
function ArtifactFailedRow({
  message,
  blocks,
  revertScope,
  styles
}: {
  message: string | null
  blocks: readonly NativeChatBlock[]
  revertScope?: string
  styles: ChatMessageStyles
}) {
  const { scheme } = useTheme()
  const toolRun = claudeToolRunPalette(scheme)
  const openRunSheet = useRunSheetOpener(blocks, revertScope)
  const label = message ?? 'Artifact'
  return (
    <View style={styles.toolRun}>
      <View style={styles.toolRunHeader}>
        <Pressable
          testID="artifact-failed-row"
          style={styles.toolRunToggle}
          onPress={openRunSheet}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Show the details`}
        >
          <Txt style={[styles.toolRunLabel, { flex: 0, flexShrink: 1 }]} numberOfLines={1}>
            {label}
          </Txt>
          <ChevronRight size={TOOL_RUN_ROW.chevronSize} color={toolRun.text} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  )
}

const cardStyles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 4,
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    // The tile's shifted bottom is cut off by the card's edge.
    overflow: 'hidden'
  },
  pressed: {
    opacity: 0.7
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: ROW_PADDING
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    marginHorizontal: TILE_MARGIN,
    marginRight: TILE_MARGIN + WORDS_GAP,
    transform: [{ translateY: TILE_SHIFT }],
    borderRadius: TILE_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: TILE_SHIFT
  },
  words: {
    flex: 1,
    paddingVertical: WORDS_PADDING_VERTICAL
  },
  subtitle: {
    marginTop: SUBTITLE_GAP
  },
  spinnerBox: {
    width: SPINNER_BOX,
    height: SPINNER_BOX,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
