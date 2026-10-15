import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Clock, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react-native'
import { claudeSessionPillPalette, type ClaudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { tapTargetHitSlop } from '../ui/tap-target'
import type { SessionCiStatus, SessionPill, SessionPrState } from './session-pill-row-model'

// The Claude Android app's session pill chip (1.261009.20): `jc20.c`, and the parts of the pull
// request pill (`jc20.q`, `xv`, `jc20.l`) that are not its layout. See MobileSessionPillRow.tsx for
// the whole row; the colours are claude-session-pill-palette.ts.

export const CHIP_RADIUS = 14
export const CHIP_PADDING_X = 12
const CHIP_PADDING_Y = 8
const CHIP_GAP = 8
export const ICON_SIZE = 16
/** Icon slot (16) plus the padding above and below it (2 x 8) is less than the label's own line,
 *  so the chip is as tall as 18 dp of text and the padding. */
const CHIP_MIN_HEIGHT = 34
const CHIP_HIT_SLOP = tapTargetHitSlop({ minHeight: CHIP_MIN_HEIGHT })
/** A pressed chip with its own fill (merged, queued) dims rather than swap to a made-up shade. */
const PRESSED_OPACITY = 0.8

/** The colour of a pull request's icon (`w130.o`): by state. */
export function stateColor(state: SessionPrState, palette: ClaudeSessionPillPalette): string {
  switch (state) {
    case 'open':
      return palette.prOpen
    case 'draft':
      return palette.prDraft
    case 'closed':
      return palette.prClosed
    case 'merged':
      return palette.mergedText
    case 'queued':
      return palette.queuedText
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

/** A chip's own fill and hairline when its state sets them (`zko`): merged and queued only. */
export function stateChip(state: SessionPrState, palette: ClaudeSessionPillPalette): { fill: string; border: string } | null {
  switch (state) {
    case 'merged':
      return { fill: palette.mergedFill, border: palette.mergedBorder }
    case 'queued':
      return { fill: palette.queuedFill, border: palette.queuedBorder }
    case 'open':
    case 'draft':
    case 'closed':
      return null
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

/** The state's own glyph (`w130.l`: draft, open, closed and merged each have one), 16 dp. */
export function PrStateIcon({
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
    case 'queued':
      return <Clock size={ICON_SIZE} color={color} strokeWidth={2.1} />
    case 'open':
      return <GitPullRequest size={ICON_SIZE} color={color} strokeWidth={2.1} />
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

function ciDotColor(ci: Exclude<SessionCiStatus, 'pending'>, palette: ClaudeSessionPillPalette): string {
  switch (ci) {
    case 'passed':
      return palette.ciPassed
    case 'failed':
      return palette.ciFailed
    case 'unavailable':
      return palette.ciUnavailable
    default: {
      const unreachable: never = ci
      return unreachable
    }
  }
}

export function Chip({
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityExpanded,
  own = null,
  onPress,
  onLongPress,
  children
}: {
  testID: string
  accessibilityLabel: string
  accessibilityHint?: string
  accessibilityExpanded?: boolean
  /** The state's own fill and hairline (merged, queued); null rests on the app's surface. */
  own?: { fill: string; border: string } | null
  onPress: () => void
  onLongPress?: () => void
  children: ReactNode
}): React.JSX.Element {
  const { colors, scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
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
        borderColor: own ? own.border : palette.border,
        backgroundColor: own ? own.fill : pressed ? colors.composerControlPressed : palette.surface,
        opacity: own && pressed ? PRESSED_OPACITY : 1
      })}
    >
      {children}
    </Pressable>
  )
}

export function CiPart({ ci }: { ci: SessionCiStatus }): React.JSX.Element {
  const { scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
        {ci === 'pending' ? (
          <ActivityIndicator size="small" color={palette.pillText} style={{ transform: [{ scale: 0.6 }] }} />
        ) : (
          <View
            testID="ci-dot"
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ciDotColor(ci, palette) }}
          />
        )}
      </View>
      <Txt variant="label" style={{ color: palette.pillText }} numberOfLines={1}>
        CI
      </Txt>
    </View>
  )
}
