import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import {
  Copy,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft
} from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useClipboardWriter } from '../platform/clipboard'
import { useTheme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { Txt } from '../ui/Txt'
import { tapTargetHitSlop } from '../ui/tap-target'
import {
  LOCAL_CHANGES_HINT_MAX_WIDTH,
  sessionCiSpoken,
  sessionPillActions,
  type SessionCiStatus,
  type SessionPill,
  type SessionPrTint
} from './session-pill-row-model'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useSessionPills } from './use-session-pills'

// The Claude Android app's session pills (1.261009.20). Every one is the generic chip `jc20.c`: a
// 14 dp radius, 12 x 8 dp padding, a 16 dp icon, an 8 dp gap, the label at 13/550, on the app's
// surface (`pl7.p`) with a hairline (`pl7.v`, ink or bone at 40%). The pull request pill (`jc20.q`,
// `xv`) reads icon, number, then CI (a 12 dp slot holding a 6 dp dot or a spinner, a 6 dp gap,
// "CI") or, for a merged PR, the word Merged on a violet chip. Create PR tints its icon `pl7.n`
// blue. Local changes opens a hint (`jc20.g`) at most 280 dp wide with 10 dp above and below.
//
// Code UI's own tokens stand in where the app's have no match: the chip surface is the composer's
// (`composerFill`, the same `pl7.p`), its hairline is the 30% step (`composerBorderFocused`, the
// nearest to `pl7.v`'s 40%), the blue is `info`, and 550 weight is the medium face the app ships.
// A 40% hairline, the `pl7.n` blue and the violet chip fills are tokens for Batch 2's token commit.

const CHIP_RADIUS = 14
const CHIP_PADDING_X = 12
const CHIP_PADDING_Y = 8
const CHIP_GAP = 8
const ICON_SIZE = 16
/** Icon slot (16) plus the padding above and below it (2 x 8) is less than the label's own line,
 *  so the chip is as tall as 18 dp of text and the padding. */
const CHIP_MIN_HEIGHT = 34
const CHIP_HIT_SLOP = tapTargetHitSlop({ minHeight: CHIP_MIN_HEIGHT })
/** The merged chip's violet over the surface, as a share of the violet. */
const MERGED_FILL_ALPHA = 0.18
const MERGED_FILL_ALPHA_PRESSED = 0.26
const MERGED_BORDER_ALPHA = 0.4

function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) {
    return color
  }
  const [r, g, b] = [match[1], match[2], match[3]].map((channel) =>
    Number.parseInt(channel ?? '0', 16)
  )
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function tintColor(tint: SessionPrTint, colors: ThemeColors): string {
  switch (tint) {
    case 'success':
      return colors.success
    case 'muted':
      return colors.textMuted
    case 'danger':
      return colors.danger
    case 'merged':
      return colors.mergedPurple
    default: {
      const unreachable: never = tint
      return unreachable
    }
  }
}

/** The state's own glyph (`w130.l`: draft, open, closed and merged each have one), 16 dp. */
function PrStateIcon({
  state,
  color
}: {
  state: Extract<SessionPill, { kind: 'pull-request' }>['state']
  color: string
}): React.JSX.Element {
  switch (state) {
    case 'draft':
      return <GitPullRequestDraft size={ICON_SIZE} color={color} strokeWidth={2.1} />
    case 'closed':
      return <GitPullRequestClosed size={ICON_SIZE} color={color} strokeWidth={2.1} />
    case 'merged':
      return <GitMerge size={ICON_SIZE} color={color} strokeWidth={2.1} />
    case 'open':
      return <GitPullRequest size={ICON_SIZE} color={color} strokeWidth={2.1} />
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

function ciDotColor(ci: Exclude<SessionCiStatus, 'pending'>, colors: ThemeColors): string {
  switch (ci) {
    case 'passed':
      return colors.success
    case 'failed':
      return colors.danger
    case 'unavailable':
      return colors.textMuted
    default: {
      const unreachable: never = ci
      return unreachable
    }
  }
}

function Chip({
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityExpanded,
  merged = false,
  onPress,
  onLongPress,
  children
}: {
  testID: string
  accessibilityLabel: string
  accessibilityHint?: string
  accessibilityExpanded?: boolean
  merged?: boolean
  onPress: () => void
  onLongPress?: () => void
  children: ReactNode
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityExpanded === undefined ? undefined : { expanded: accessibilityExpanded }}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: CHIP_GAP,
        borderRadius: CHIP_RADIUS,
        paddingHorizontal: CHIP_PADDING_X,
        paddingVertical: CHIP_PADDING_Y,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: merged
          ? withAlpha(colors.mergedPurple, MERGED_BORDER_ALPHA)
          : colors.composerBorderFocused,
        backgroundColor: merged
          ? withAlpha(colors.mergedPurple, pressed ? MERGED_FILL_ALPHA_PRESSED : MERGED_FILL_ALPHA)
          : pressed
            ? colors.composerControlPressed
            : colors.composerFill
      })}
    >
      {children}
    </Pressable>
  )
}

function CiPart({ ci }: { ci: SessionCiStatus }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
        {ci === 'pending' ? (
          <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.6 }] }} />
        ) : (
          <View
            testID="ci-dot"
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ciDotColor(ci, colors) }}
          />
        )}
      </View>
      <Txt variant="label" tone="muted" numberOfLines={1}>
        CI
      </Txt>
    </View>
  )
}

function PullRequestChip({
  pill,
  onPress,
  onLongPress
}: {
  pill: Extract<SessionPill, { kind: 'pull-request' }>
  onPress: () => void
  onLongPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  const tint = tintColor(pill.tint, colors)
  const merged = pill.state === 'merged'
  // The app's icon says the state, the number says the pull request, CI says its sentence.
  const spoken = [pill.spoken, pill.stateLabel, pill.ci ? sessionCiSpoken(pill.ci) : null]
    .filter((part): part is string => part !== null)
    .join(', ')
  return (
    <Chip
      testID="pull-request-pill"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the pull request. Hold to copy its number"
      merged={merged}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <PrStateIcon state={pill.state} color={tint} />
      <Txt
        variant="label"
        style={{ color: merged ? colors.mergedPurple : colors.textMuted, flexShrink: 1 }}
        numberOfLines={1}
      >
        {pill.label}
      </Txt>
      {merged ? (
        <Txt variant="label" weight="medium" style={{ color: colors.mergedPurple }} numberOfLines={1}>
          {pill.stateLabel}
        </Txt>
      ) : pill.ci ? (
        <CiPart ci={pill.ci} />
      ) : null}
    </Chip>
  )
}

/**
 * The pills, drawn from the model. Pure of any connection: the connected `MobileSessionPillRow`
 * feeds it, and the tests drive it directly in light and dark.
 */
export function SessionPillRowView({
  pills,
  onOpenPullRequest,
  onCopyPrNumber
}: {
  pills: readonly SessionPill[]
  /** The pull request pill and Create PR both land on the pull request panel. */
  onOpenPullRequest: () => void
  onCopyPrNumber: (number: number) => void
}): React.JSX.Element | null {
  const { colors, space } = useTheme()
  const [hintOpen, setHintOpen] = useState(false)
  const [copyingNumber, setCopyingNumber] = useState<number | null>(null)
  const local = pills.find((pill) => pill.kind === 'local-changes')
  // A pill that goes away (a PR was opened) takes its open hint with it; if the branch is local
  // again later, the hint starts closed rather than reappearing from before.
  if (hintOpen && !local) {
    setHintOpen(false)
  }
  // The same for the copy menu: it belongs to the pull request it was opened on. A branch switch
  // or a failed refresh takes that pill away without closing the menu, and the next pull request
  // must not inherit it (and copy the old number).
  const copyingStillDrawn = pills.some(
    (pill) => pill.kind === 'pull-request' && pill.number === copyingNumber
  )
  if (copyingNumber !== null && !copyingStillDrawn) {
    setCopyingNumber(null)
  }
  if (pills.length === 0) {
    return null
  }
  const hint = hintOpen && local?.kind === 'local-changes' ? local.hint : null
  const hasPullRequest = pills.some((pill) => pill.kind === 'pull-request')
  return (
    <View
      testID="session-pill-row"
      style={{ paddingHorizontal: space.md, paddingBottom: space.xs, gap: space.xs }}
    >
      {/* In the flow above the pills, not floated over the chat: it is laid out before the row it
          explains, so nothing needs a z-index and a tap on it lands. */}
      {hint !== null ? (
        <Pressable
          testID="local-changes-hint"
          accessibilityRole="button"
          accessibilityLabel={hint}
          accessibilityHint="Dismisses this hint"
          onPress={() => setHintOpen(false)}
          style={{
            alignSelf: 'flex-start',
            maxWidth: LOCAL_CHANGES_HINT_MAX_WIDTH,
            paddingVertical: 10,
            paddingHorizontal: CHIP_PADDING_X,
            borderRadius: CHIP_RADIUS,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.composerBorder,
            backgroundColor: colors.composerFill
          }}
        >
          <Txt variant="label" tone="secondary">
            {hint}
          </Txt>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {pills.map((pill) => {
          switch (pill.kind) {
            case 'pull-request':
              return (
                <PullRequestChip
                  key={`pr-${pill.number}`}
                  pill={pill}
                  onPress={onOpenPullRequest}
                  onLongPress={() => setCopyingNumber(pill.number)}
                />
              )
            case 'create-pr':
              return (
                <Chip
                  key="create-pr"
                  testID="create-pr-pill"
                  accessibilityLabel={pill.label}
                  accessibilityHint="Opens the pull request panel"
                  onPress={onOpenPullRequest}
                >
                  <GitPullRequest size={ICON_SIZE} color={colors.info} strokeWidth={2.1} />
                  <Txt variant="label" weight="medium" numberOfLines={1}>
                    {pill.label}
                  </Txt>
                </Chip>
              )
            case 'local-changes':
              return (
                <Chip
                  key="local-changes"
                  testID="local-changes-pill"
                  accessibilityLabel={pill.label}
                  accessibilityHint="Shows why there is no pull request"
                  accessibilityExpanded={hintOpen}
                  onPress={() => setHintOpen((open) => !open)}
                >
                  <GitBranch size={ICON_SIZE} color={colors.text} strokeWidth={2.1} />
                  <Txt variant="label" weight="medium" numberOfLines={1}>
                    {pill.label}
                  </Txt>
                </Chip>
              )
            default: {
              const unreachable: never = pill
              return unreachable
            }
          }
        })}
      </View>
      {hasPullRequest ? (
        <ActionSheetModal
          visible={copyingNumber !== null}
          actions={[
            {
              label: 'Copy PR number',
              icon: Copy,
              onPress: () => {
                if (copyingNumber !== null) {
                  onCopyPrNumber(copyingNumber)
                }
              }
            }
          ]}
          onClose={() => setCopyingNumber(null)}
        />
      ) : null}
    </View>
  )
}

/**
 * The session pills above the composer, fed by what Orca answered for this worktree's branch.
 * Mounted through the chat overlay's pill slot; draws nothing until there is something to say.
 */
export function MobileSessionPillRow({
  controller
}: {
  controller: MobileSessionController
}): React.JSX.Element | null {
  const { showToast, handlePanelTap } = controller
  const clipboard = useClipboardWriter()
  const pills = useSessionPills(controller)
  const actions = sessionPillActions({ clipboard, showToast })
  return (
    <SessionPillRowView
      pills={pills}
      onOpenPullRequest={() => handlePanelTap('pr')}
      onCopyPrNumber={(number) => void actions.copyPrNumber(number)}
    />
  )
}
