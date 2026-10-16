import { Pressable } from 'react-native'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { ClaudeArtifactsGlyph } from './ClaudeArtifactsGlyph'
import { ClaudeOutputsGlyph } from './ClaudeOutputsGlyph'
import { ICON_SIZE } from './MobileSessionPillChip'
import type { SessionPill } from './session-pill-row-model'

// The Claude app's session bar outputs pill (1.261013.20) and the pull request tap it shares with
// the Outputs sheet. The row that lays them out is MobileSessionPillRow.tsx; the rule that picks
// the kind is session-outputs.ts.

/** The outputs pill's padding (`u8z.t`: 16 across, `u8z.c` = 10 down) around a 13/18 label. */
const OUTPUTS_PADDING_X = 16
const OUTPUTS_PADDING_Y = 10
/** The pill's own height: the label's 18 dp line and 10 dp above and below it. */
export const OUTPUTS_PILL_HEIGHT = 18 + OUTPUTS_PADDING_Y * 2
/** The app's 48 dp touch box (`tv30.l(.., 48)` in `u8z.d`), reached by slop so the row keeps the
 *  height of the chips beside it. Above the shared 44 dp floor (tap-target.ts) on purpose. */
const OUTPUTS_TOUCH_BOX = 48
const OUTPUTS_SLOP_Y = Math.ceil((OUTPUTS_TOUCH_BOX - OUTPUTS_PILL_HEIGHT) / 2)
const OUTPUTS_HIT_SLOP = { top: OUTPUTS_SLOP_Y, bottom: OUTPUTS_SLOP_Y, left: 0, right: 0 }

/**
 * The session bar's outputs control as the Claude app draws it (1.261013.20, `u8z.h` through the
 * bar's button `u8z.d`, u8z.java:200 and :3778-3806): a full-round pill (`b2t.a`, 50%) on
 * `ad5.n0()` with no hairline, padded 16 x 10 (`u8z.t`, u8z.java:4778-4786), holding the kind's
 * glyph (`yu0.u` = 16 dp), 8 dp, then its label in `xo7.G` (13, medium), both in `ad5.x0()`, on one
 * ellipsized line (r3z case 1). The glyph by kind (r3z case 1, wu0.java): artifacts U+E017, plan
 * `scroll` U+E0D2, Mixed `files` U+E06F. Labels and readings are `ns30.H` / `ns30.G`.
 */
export function OutputsPill({
  testID,
  accessibilityLabel,
  label,
  glyph,
  onPress
}: {
  testID: string
  accessibilityLabel: string
  label: string
  glyph: 'artifacts' | 'scroll' | 'files'
  onPress: () => void
}): React.JSX.Element {
  const { colors, scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
  const glyphTestID = `${testID}-glyph`
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={OUTPUTS_HIT_SLOP}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: 8,
        height: OUTPUTS_PILL_HEIGHT,
        borderRadius: OUTPUTS_PILL_HEIGHT / 2,
        paddingHorizontal: OUTPUTS_PADDING_X,
        paddingVertical: OUTPUTS_PADDING_Y,
        backgroundColor: pressed ? colors.composerControlPressed : palette.outputsFill
      })}
    >
      {glyph === 'artifacts' ? (
        <ClaudeArtifactsGlyph testID={glyphTestID} size={ICON_SIZE} color={palette.outputsInk} />
      ) : (
        <ClaudeOutputsGlyph testID={glyphTestID} name={glyph} size={ICON_SIZE} color={palette.outputsInk} />
      )}
      <Txt variant="label" weight="medium" style={{ color: palette.outputsInk, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** What a pull request pill's tap does: a PR Anthropic reported opens its page, any other the
 *  pull request panel. The pill and the Outputs sheet's row share it. */
export function openPullRequestPill(
  pill: Extract<SessionPill, { kind: 'pull-request' }>,
  onOpenUrl: ((url: string) => void) | undefined,
  onOpenPullRequest: () => void
): void {
  if (pill.source === 'claude' && pill.url && onOpenUrl) {
    onOpenUrl(pill.url)
  } else {
    onOpenPullRequest()
  }
}
