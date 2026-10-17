import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { refreshClaudeArtifactList, useClaudeArtifactList } from './claude-artifact-list-store'
import { ClaudeOutputsGlyph } from './ClaudeOutputsGlyph'
import { ArtifactRow } from './MobileSessionArtifactsSheet'
import { CiPart, PrStateIcon, stateColor } from './MobileSessionPillChip'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { openClaudeArtifact } from './open-claude-artifact'
import { sessionArtifactRows, type ArtifactSheetRow, type SessionArtifact } from './session-artifacts'
import type { SessionPill } from './session-pill-row-model'

/** The sheet's title (`ccr_thread_outputs_title`, bottomsheet/b.java:2665-2683, for kind Mixed). */
export const SESSION_OUTPUTS_TITLE = 'Outputs'

type PullRequestPill = Extract<SessionPill, { kind: 'pull-request' }>

/**
 * The Claude app's Outputs sheet, opened from the session bar's "N outputs" pill (1.261013.20):
 * titled "Outputs" (bottomsheet/b.java:2665-2683) and laid out by `fp30.f` / cv6 case 5: the plan
 * first, then "Pull requests (N)" and its rows, then "Artifacts (N)" and its rows, the two headers
 * drawn because the kind is Mixed (fp30.java:446-450), 12 dp between items.
 *
 * The rows themselves are Code UI's cards, not a reading of the app's (m74 cases 4 and 5, a9t
 * case 6 were not decompiled to their pixels): the pull request with its state and CI as its pill
 * shows them, the plan, and the session's own artifacts as the Artifacts sheet draws them. Every
 * tap closes this sheet first and then does what the separate pill would have done.
 *
 * Code UI's only pull request input is the branch's PR pill, so the section holds at most one row.
 */
export function MobileSessionOutputsSheet({
  visible,
  onClose,
  pullRequest,
  onOpenPullRequest,
  hasPlan,
  onOpenPlan,
  artifacts,
  accountId
}: {
  visible: boolean
  onClose: () => void
  pullRequest: PullRequestPill | null
  onOpenPullRequest: (pill: PullRequestPill) => void
  hasPlan: boolean
  onOpenPlan: () => void
  artifacts: readonly SessionArtifact[]
  accountId: string | null
}) {
  const { space } = useTheme()
  const list = useClaudeArtifactList(accountId)
  useEffect(() => {
    if (visible && accountId && artifacts.length > 0) {
      void refreshClaudeArtifactList(accountId, { force: true })
    }
  }, [visible, accountId, artifacts.length])
  const rows = sessionArtifactRows(artifacts, accountId ? list.items : [])
  const then = (action: () => void) => () => {
    onClose()
    action()
  }
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss
      expandable
      header={<MobileSheetTitleBar title={SESSION_OUTPUTS_TITLE} onClose={onClose} />}
    >
      <View testID="session-outputs-sheet" style={{ gap: 12, paddingBottom: 16 }}>
        {hasPlan ? <PlanRow onPress={then(onOpenPlan)} /> : null}
        {pullRequest !== null ? (
          <>
            <SectionHeader testID="outputs-section-pull-requests" label="Pull requests (1)" />
            <PullRequestRow pill={pullRequest} onPress={then(() => onOpenPullRequest(pullRequest))} />
          </>
        ) : null}
        {rows.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionHeader testID="outputs-section-artifacts" label={`Artifacts (${rows.length})`} />
            {rows.map((row: ArtifactSheetRow) => (
              <ArtifactRow
                key={row.uuid}
                testID={`outputs-artifact-row-${row.uuid}`}
                row={row}
                onPress={then(() => openClaudeArtifact(accountId ? { url: row.url, title: row.title, accountId } : { url: row.url, title: row.title }))}
              />
            ))}
          </View>
        ) : null}
      </View>
    </BottomDrawer>
  )
}

/** A section's "Pull requests (N)" / "Artifacts (N)" (`fp30.t`, fp30.java:1244-1252). */
function SectionHeader({ testID, label }: { testID: string; label: string }) {
  return (
    <View testID={testID} style={{ paddingHorizontal: 4 }}>
      <Txt variant="label" weight="semibold" tone="secondary">
        {label}
      </Txt>
    </View>
  )
}

function useCardStyle() {
  const { colors, space, radius } = useTheme()
  return ({ pressed }: { pressed: boolean }) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.bgSunken : colors.bgRaised
  })
}

function PlanRow({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme()
  const card = useCardStyle()
  return (
    <Pressable testID="outputs-plan-row" accessibilityRole="button" accessibilityLabel="Open plan" onPress={onPress} style={card}>
      <ClaudeOutputsGlyph name="scroll" size={20} color={colors.text} />
      <Txt variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
        Plan
      </Txt>
    </Pressable>
  )
}

function PullRequestRow({ pill, onPress }: { pill: PullRequestPill; onPress: () => void }) {
  const { scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
  const card = useCardStyle()
  const tint = stateColor(pill.state, palette)
  return (
    <Pressable
      testID={`outputs-pr-row-${pill.number}`}
      accessibilityRole="button"
      accessibilityLabel={`${pill.spoken}, ${pill.stateLabel}`}
      onPress={onPress}
      style={card}
    >
      <PrStateIcon state={pill.state} color={tint} />
      <Txt variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
        {pill.label}
      </Txt>
      <Txt variant="label" style={{ color: tint }} numberOfLines={1}>
        {pill.stateLabel}
      </Txt>
      {pill.ci ? <CiPart ci={pill.ci} /> : null}
    </Pressable>
  )
}
