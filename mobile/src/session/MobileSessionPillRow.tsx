import { useCallback, useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { Copy, GitBranch, GitPullRequest } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useClipboardWriter } from '../platform/clipboard'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { OutputsPill, openPullRequestPill } from './MobileSessionOutputsPill'
import {
  LOCAL_CHANGES_HINT_MAX_WIDTH,
  sessionCiSpoken,
  sessionPillActions,
  type SessionPill
} from './session-pill-row-model'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useSessionPills } from './use-session-pills'
import { useClaudeAppCommandSheet } from './claude-app-command-sheets'
import { MobileClaudePlanSheet } from './MobileClaudePlanSheet'
import { MobileClaudeAutoDefaultNotice, claudeAutoDefaultNoticeEligible } from './MobileClaudeAutoDefaultNotice'
import { MobileSessionArtifactsSheet } from './MobileSessionArtifactsSheet'
import { sessionArtifactsPillLabel } from './session-artifacts'
import { sessionOutputsControl } from './session-outputs'
import { MobileSessionOutputsSheet } from './MobileSessionOutputsSheet'
import { useClaudeTabAccount } from './use-claude-tab-account'

// The Claude Android app's session pills (1.261009.20). Every one is the generic chip `jc20.c`: a
// 14 dp radius, 12 x 8 dp padding, a 16 dp icon, an 8 dp gap, the label at 13/550, on the app's
// surface (`pl7.p`) with a hairline (`pl7.v`, ink or bone at 40%). The pull request pill (`jc20.q`,
// `xv`) reads icon, number, then CI (a 12 dp slot holding a 6 dp dot or a spinner, a 6 dp gap,
// "CI") or, for a merged PR, the word Merged on a violet chip. Create PR tints its icon `pl7.n`
// blue. Local changes opens a hint (`jc20.g`) at most 280 dp wide with 10 dp above and below.
//
// Colours are the app's own, resolved per scheme in claude-session-pill-palette.ts (surface `pl7.p`,
// hairline `pl7.v` at 40%, a state's icon by `w130.o`, merged `ad5.i0()`/`ad5.a0()`/`ad5.T()`, the CI
// dot by `jc20.l`). The Diff pill (`jc20.p`, `ju8`) is the same chip: "Diff" at 13/550, an 8 dp gap,
// then "+N" green and " -M" red at 13 regular (`jlc.b`), a count of nothing not drawn. The blue of
// Create PR's icon is `info`, and 550 weight is the medium face the app ships.
//
// The artifacts button is not that chip: it is the 1.261013.20 session bar's outputs pill
// (MobileSessionOutputsPill.tsx), full-round on `ad5.n0()` with the artifacts glyph.

export { OUTPUTS_PILL_HEIGHT } from './MobileSessionOutputsPill'
import { Chip, CHIP_PADDING_X, CHIP_RADIUS, CiPart, ICON_SIZE, PrStateIcon, stateChip, stateColor } from './MobileSessionPillChip'

function PullRequestChip({
  pill,
  onPress,
  onLongPress
}: {
  pill: Extract<SessionPill, { kind: 'pull-request' }>
  onPress: () => void
  onLongPress: () => void
}): React.JSX.Element {
  const { scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
  const tint = stateColor(pill.state, palette)
  const own = stateChip(pill.state, palette)
  // The app's icon says the state, the number says the pull request, CI says its sentence.
  const spoken = [pill.spoken, pill.stateLabel, pill.ci ? sessionCiSpoken(pill.ci) : null]
    .filter((part): part is string => part !== null)
    .join(', ')
  return (
    <Chip
      testID="pull-request-pill"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the pull request. Hold to copy its number"
      own={own}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <PrStateIcon state={pill.state} color={tint} />
      <Txt
        variant="label"
        style={{ color: own ? tint : palette.pillText, flexShrink: 1 }}
        numberOfLines={1}
      >
        {pill.label}
      </Txt>
      {own ? (
        <Txt variant="label" weight="medium" style={{ color: tint }} numberOfLines={1}>
          {pill.stateLabel}
        </Txt>
      ) : pill.ci ? (
        <CiPart ci={pill.ci} />
      ) : null}
    </Chip>
  )
}

/** The Diff pill (`jc20.p`): the label, then the PR's added and removed line totals (`jlc.b`). */
function DiffChip({
  pill,
  onPress
}: {
  pill: Extract<SessionPill, { kind: 'diff' }>
  onPress: () => void
}): React.JSX.Element {
  const { colors, scheme } = useTheme()
  const palette = claudeSessionPillPalette(scheme)
  return (
    <Chip
      testID="diff-pill"
      accessibilityLabel={`Diff, ${pill.added} lines added, ${pill.removed} lines removed`}
      accessibilityHint="Opens the pull request's changed files"
      onPress={onPress}
    >
      <Txt variant="label" weight="medium" style={{ color: colors.text }} numberOfLines={1}>
        {pill.label}
      </Txt>
      <Txt variant="label" numberOfLines={1}>
        {pill.added > 0 ? (
          <Txt testID="diff-pill-added" variant="label" style={{ color: palette.countAddText }}>
            {`+${pill.added}`}
          </Txt>
        ) : null}
        {pill.removed > 0 ? (
          <Txt testID="diff-pill-removed" variant="label" style={{ color: palette.countDelText }}>
            {`${pill.added > 0 ? ' ' : ''}-${pill.removed}`}
          </Txt>
        ) : null}
      </Txt>
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
  onOpenUrl,
  onCopyPrNumber,
  onOpenPlan,
  artifacts,
  onOpenOutputs
}: {
  pills: readonly SessionPill[]
  /** The pull request pill and Create PR both land on the pull request panel. */
  onOpenPullRequest: () => void
  /** A pull request Anthropic reported (`source: 'claude'`) and the Diff pill open its page: the
   *  Orca panel is for the worktree's own branch, which is not that one. */
  onOpenUrl?: (url: string) => void
  onCopyPrNumber: (number: number) => void
  /** A matched Claude tab with a proposed plan: the app's "Plan" pill (claude-session-plan.ts). */
  onOpenPlan?: (() => void) | null
  /** A Claude tab whose session published a page: the app's "Open artifacts" button
   *  (ns30.java:610-660), counting them (session-artifacts.ts). */
  artifacts?: { sessionCount: number; onOpen: () => void } | null
  /** Opens the Outputs sheet. With it, two or more of a pull request, artifacts and a plan fold
   *  into one "N outputs" pill (session-outputs.ts); without it (a caller with no sheet to open)
   *  each keeps its own pill rather than drawing a pill that cannot open anything. */
  onOpenOutputs?: (() => void) | null
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
  if (pills.length === 0 && !onOpenPlan && !artifacts) {
    return null
  }
  const hint = hintOpen && local?.kind === 'local-changes' ? local.hint : null
  const hasPullRequest = pills.some((pill) => pill.kind === 'pull-request')
  // The app's rule (session-outputs.ts). Its pull request count is the session's own PR list; Code
  // UI's one honest input is the branch's PR pill, so a pull request counts 1 when that pill would
  // show and 0 otherwise.
  const outputs = sessionOutputsControl({
    pullRequests: hasPullRequest ? 1 : 0,
    artifacts: artifacts?.sessionCount ?? 0,
    plan: Boolean(onOpenPlan)
  })
  const mixed = outputs?.kind === 'mixed' && onOpenOutputs ? outputs : null
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {pills.map((pill) => {
          switch (pill.kind) {
            case 'diff':
              return (
                <DiffChip
                  key="diff"
                  pill={pill}
                  onPress={() => (onOpenUrl ? onOpenUrl(pill.url) : onOpenPullRequest())}
                />
              )
            case 'pull-request':
              // Folded into "N outputs" with the artifacts or the plan (os30.q).
              return mixed ? null : (
                <PullRequestChip
                  key={`pr-${pill.number}`}
                  pill={pill}
                  onPress={() => openPullRequestPill(pill, onOpenUrl, onOpenPullRequest)}
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
        {/* The app's outputs control, last in its session bar above the composer (`u8z.e`,
            u8z.java:643-690, after Diff, Local changes and Create PR): "N outputs" for two kinds or
            more, else the one kind's own control. A lone pull request keeps its own pill above. */}
        {mixed ? (
          <OutputsPill
            key="outputs"
            testID="outputs-pill"
            accessibilityLabel={mixed.accessibilityLabel}
            label={mixed.label}
            glyph="files"
            onPress={onOpenOutputs!}
          />
        ) : (
          <>
            {/* "Plan" (`session_pill_plan`), read "Open plan" (`ccr_session_bar_open_plan`). */}
            {onOpenPlan ? (
              <OutputsPill key="plan" testID="plan-pill" accessibilityLabel="Open plan" label="Plan" glyph="scroll" onPress={onOpenPlan} />
            ) : null}
            {/* "%d artifact(s)", read "Open artifacts" (`ccr_thread_header_open_artifacts`). */}
            {artifacts ? (
              <OutputsPill
                key="artifacts"
                testID="artifacts-pill"
                accessibilityLabel="Open artifacts"
                label={sessionArtifactsPillLabel(artifacts.sessionCount)}
                glyph="artifacts"
                onPress={artifacts.onOpen}
              />
            ) : null}
          </>
        )}
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

/** Opens the page of a pull request Anthropic reported. Only an https address is opened, and a
 *  refusal says so: a tap that does nothing is indistinguishable from a slow one. */
async function openPullRequestUrl(url: string, showToast: (message: string, durationMs?: number) => void): Promise<void> {
  try {
    if (!/^https:\/\//i.test(url)) {
      throw new Error('not an https address')
    }
    await Linking.openURL(url)
  } catch (error) {
    console.warn(`[session-pills] could not open the pull request: ${error instanceof Error ? error.message : String(error)}`)
    showToast("Couldn't open the pull request", 1500)
  }
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
  const plan = controller.nativeChatController.nativeChatClaudePlan ?? null
  const [planOpen, setPlanOpen] = useState(false)
  // A Claude tab's artifacts: the pages its own conversation published, and nothing else. The button
  // shows only when there is one, as the Claude app draws no outputs control for a session with no
  // pull request, artifact or plan (`ThreadOutputsTally`, ds8.java:257-268; os30.q,
  // os30.java:687-711); the account's other pages are the gallery's (reported 2026-10-16).
  // Codex and shell tabs have no `nativeChatClaudeArtifacts`.
  const claudeArtifacts = controller.nativeChatController.nativeChatClaudeArtifacts
  const artifactAccount = useClaudeTabAccount(claudeArtifacts?.account ?? null)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const showArtifacts = claudeArtifacts !== undefined && claudeArtifacts.artifacts.length > 0
  // The tab stops being a Claude tab (or loses every page) with the sheet open: it goes with it.
  if (artifactsOpen && !showArtifacts) {
    setArtifactsOpen(false)
  }
  // A plan that goes away (its successor's approval is asked) takes its open sheet with it.
  if (planOpen && plan === null) {
    setPlanOpen(false)
  }
  // The "N outputs" pill's sheet: open only while the bar still folds two kinds or more.
  const pullRequest = pills.find((pill): pill is Extract<SessionPill, { kind: 'pull-request' }> => pill.kind === 'pull-request') ?? null
  const outputsMixed =
    sessionOutputsControl({
      pullRequests: pullRequest ? 1 : 0,
      artifacts: showArtifacts ? claudeArtifacts.artifacts.length : 0,
      plan: plan !== null
    })?.kind === 'mixed'
  const [outputsOpen, setOutputsOpen] = useState(false)
  if (outputsOpen && !outputsMixed) {
    setOutputsOpen(false)
  }
  const openUrl = (url: string) => void openPullRequestUrl(url, showToast)
  const actions = sessionPillActions({ clipboard, showToast })
  // A matched Claude tab's typed /diff opens the changes, as the Claude app's does
  // (claude-app-command-sheets.ts). Published here because this row is mounted with the chat.
  useClaudeAppCommandSheet('diff', useCallback(() => handlePanelTap('sourceControl'), [handlePanelTap]))
  return (
    <>
      <SessionPillRowView
        pills={pills}
        onOpenPullRequest={() => handlePanelTap('pr')}
        onOpenUrl={openUrl}
        onCopyPrNumber={(number) => void actions.copyPrNumber(number)}
        onOpenPlan={plan === null ? null : () => setPlanOpen(true)}
        artifacts={showArtifacts ? { sessionCount: claudeArtifacts.artifacts.length, onOpen: () => setArtifactsOpen(true) } : null}
        onOpenOutputs={() => setOutputsOpen(true)}
      />
      {outputsMixed ? (
        <MobileSessionOutputsSheet
          visible={outputsOpen}
          onClose={() => setOutputsOpen(false)}
          pullRequest={pullRequest}
          onOpenPullRequest={(pill) => openPullRequestPill(pill, openUrl, () => handlePanelTap('pr'))}
          hasPlan={plan !== null}
          onOpenPlan={() => setPlanOpen(true)}
          artifacts={showArtifacts ? claudeArtifacts.artifacts : []}
          accountId={artifactAccount}
        />
      ) : null}
      {showArtifacts ? (
        <MobileSessionArtifactsSheet
          visible={artifactsOpen}
          onClose={() => setArtifactsOpen(false)}
          artifacts={claudeArtifacts.artifacts}
          accountId={artifactAccount}
        />
      ) : null}
      {plan !== null ? <MobileClaudePlanSheet visible={planOpen} plan={plan} onClose={() => setPlanOpen(false)} /> : null}
      {/* The app's one-time "Auto mode is now Claude Code’s default" notice (jv30.java:75). */}
      <MobileClaudeAutoDefaultNotice eligible={claudeAutoDefaultNoticeEligible(controller.nativeChatController)} />
    </>
  )
}
