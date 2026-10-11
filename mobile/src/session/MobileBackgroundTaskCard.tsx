import { Pressable, View } from 'react-native'
import { Activity, ChevronRight, Diamond, ListTree, SquareCode } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask, BackgroundTaskKind } from './mobile-background-tasks'
import { MobileWorkflowCard } from './MobileWorkflowCard'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  formatBackgroundTaskElapsed,
  formatTokenCount
} from './mobile-background-task-labels'

/**
 * One task, as the Claude Android app's Background tasks sheet draws it (screenshot, 2026-10-10;
 * re-measured beside Code UI on the same phone, 2026-10-11): a card darker than the sheet with the
 * kind's glyph, a 14/19 semibold title (two lines at most), then the kind in the title's ink and its
 * live time ("Shell  41s") or how it ended ("Shell  Completed") in the muted ink. No card carries a
 * Stop: the user asked for the round one at the right gone (2026-10-11, no-stop.test.tsx), though
 * the Claude app does draw one (docs/mobile-background-tasks.md, "No Stop on any row"). The fork's
 * "View transcript" link is gone (2026-10-10, not in Orca). A finished shell given `onShowOutput`
 * is tappable, with a chevron at its right, as the Claude app's "Show output" row is (parity G27).
 */
export function MobileBackgroundTaskCard({
  task,
  statusUnknown = false,
  onShowOutput
}: {
  task: BackgroundTask
  /** No connection to the host: a running row cannot say it runs, so its time reads "Status
   *  unknown". */
  statusUnknown?: boolean
  /** Opens a finished shell's output; ignored on any other row. */
  onShowOutput?: (task: BackgroundTask) => void
}) {
  const { colors, radius, space } = useTheme()
  if (task.workflow) {
    return <MobileWorkflowCard task={task} statusUnknown={statusUnknown} />
  }
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs)
  const running = task.status === 'running'
  const showOutput = onShowOutput && task.kind === 'shell' && !running ? () => onShowOutput(task) : null
  const card = (
    <View
      testID="background-task-card"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
        // Claude's card: 16 dp above, below and before the glyph, 24 dp at the right.
        paddingTop: space.lg,
        paddingBottom: space.lg,
        paddingLeft: space.lg,
        paddingRight: space.xl,
        borderRadius: radius.md,
        backgroundColor: colors.bgSunken
      }}
    >
      <View style={{ height: TITLE_LINE, width: 16, alignItems: 'center', justifyContent: 'center' }}>
        <BackgroundTaskGlyph kind={task.kind} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {/* An agent's title is its Agent call's description, running or not, as
            the Claude app's rows read ("Show chat images like Claude"), never
            the call it is in (the user, 2026-10-11; agent-title.test.tsx). */}
        <Txt variant="label" weight="semibold" numberOfLines={2} style={{ fontSize: 14, lineHeight: TITLE_LINE }}>
          {task.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Txt variant="caption">{backgroundTaskKindLabel(task.kind)}</Txt>
          {running && statusUnknown ? (
            <Txt variant="caption" tone="muted">
              Status unknown
            </Txt>
          ) : running ? (
            elapsed ? (
              <Txt variant="caption" tone="muted">
                {elapsed}
              </Txt>
            ) : null
          ) : (
            <Txt variant="caption" tone={task.status === 'failed' ? 'danger' : 'muted'}>
              {backgroundTaskStatusLabel(task.status)}
            </Txt>
          )}
          {task.totalTokens !== undefined && !(running && statusUnknown) ? (
            <Txt variant="caption" tone="muted">
              {`${formatTokenCount(task.totalTokens)} tokens`}
            </Txt>
          ) : null}
        </View>
      </View>
      {showOutput ? (
        <View style={{ height: TITLE_LINE, justifyContent: 'center' }}>
          <ChevronRight size={16} color={colors.textMuted} />
        </View>
      ) : null}
    </View>
  )
  return showOutput ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, Show output`}
      onPress={showOutput}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {card}
    </Pressable>
  ) : (
    card
  )
}

/** The title's line height: the glyph is centred on its first line, as in Claude's. */
const TITLE_LINE = 19

/** One glyph per kind: for a shell, Claude's sheet draws an open window whose top edge is broken by
 *  a `</>` mark (the user's screenshots of 2026-10-11); lucide has no such glyph, and SquareCode, a
 *  window holding a code mark, is the nearest (SquareTerminal's prompt, AppWindow's dots and the
 *  bare CodeXml are each further off). The hollow diamond for an agent, and their own for a monitor
 *  and a workflow, so neither reads as a shell. Plain markers in the secondary ink. */
function BackgroundTaskGlyph({ kind }: { kind: BackgroundTaskKind }) {
  const { colors } = useTheme()
  switch (kind) {
    case 'agent':
      return <Diamond size={11} color={colors.textSecondary} />
    case 'monitor':
      return <Activity size={16} color={colors.textSecondary} />
    case 'workflow':
      return <ListTree size={16} color={colors.textSecondary} />
    case 'shell':
    case 'unknown':
      return <SquareCode size={16} color={colors.textSecondary} />
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
