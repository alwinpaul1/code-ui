import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  SquareTerminal,
  Wrench
} from 'lucide-react-native'
import { ShowMoreCalls } from './MobileNativeChatToolRunBodyParts'
import { ToolLine } from './MobileNativeChatToolLine'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
import {
  mobileTaskListPreview,
  mobileTaskListRows,
  type MobileTaskListPredecessors
} from './mobile-native-chat-task-list-rows'
import { toolRunSentenceShowsFailures, toolRunSentenceSpans } from './mobile-native-chat-tool-sentence'
import { ToolRunSentenceText } from './MobileNativeChatToolRunSentence'
import { toolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'
import { useCreatedFileCounts } from './MobileNativeChatCreatedFileCounts'
import { ToolRunDiffChip } from './MobileNativeChatToolRunDiffChip'
import { toolPairOpensDetailSheet } from './mobile-native-chat-tool-detail'
import { MobileNativeChatToolDetailSheet } from './MobileNativeChatToolDetailSheet'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { nativeChatToolRunOutcome } from '../../../src/shared/native-chat-tool-run-outcome'
import type { NativeChatToolPair as ToolPair } from '../../../src/shared/native-chat-tool-fold'
import { isShellActivityToolCall } from '../../../src/shared/native-chat-tool-icon'
import {
  isToolCallBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { ShimmerText } from './MobileNativeChatShimmerText'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import { agentRunState, isAgentToolName, runningAgentText } from './mobile-native-chat-agent-run'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { useNativeChatAgentRuns, useRunSheetOpener } from './native-chat-tasks-context'

/** Calls a run's body shows before a "Show N more tool calls" button. This
 *  client's own: the desktop's NativeChatToolRun draws every call. */
const MAX_VISIBLE_TOOL_PAIRS = 6
/** Diff rows a run's first page shares out, two diffs a call: the call's own
 *  and its result's (ToolRun's `diffLineLimit`). */
const MAX_TOOL_RUN_DIFF_ROWS = 240

/** A run of a message's tool calls/results, collapsed to a one-line summary
 *  ("2×  Read src/app.ts · Edit …", Codex-app style) that expands to the inline
 *  tool lines. `defaultExpanded` lets the global toolbar toggle drive every run. */
export function ToolRun(props: ToolRunProps) {
  return <ToolRunView {...props} />
}

/** Hands its children whether an agent of the run still runs. Only a run that
 *  holds an Agent/Task call reads the chat's agent state, which changes with
 *  every message and status update: read by every run it re-rendered each one
 *  under the memoised message row (review, 2026-10-01). It wraps the header
 *  alone, so a run gaining its first Agent call swaps only the header's subtree:
 *  the run's own state (open row, detail sheet, shown calls, sheet owner) lives
 *  above it and survives. */
function RunningAgentGate({
  blocks,
  enabled,
  children
}: {
  blocks: NativeChatBlock[]
  enabled: boolean
  children: (runningAgent: boolean, subject: string | null) => React.ReactNode
}) {
  return enabled ? <ReadsAgents blocks={blocks}>{children}</ReadsAgents> : <>{children(false, null)}</>
}

function ReadsAgents({
  blocks,
  children
}: {
  blocks: NativeChatBlock[]
  children: (runningAgent: boolean, subject: string | null) => React.ReactNode
}) {
  const agentRuns = useNativeChatAgentRuns()
  const state = useMemo(() => agentRunState(blocks, agentRuns), [blocks, agentRuns])
  return <>{children(state.running, state.subject)}</>
}

type ToolRunProps = {
  blocks: NativeChatBlock[]
  defaultExpanded: boolean
  /** Child tool lines stay collapsed when the turn caret drove the run open.
   *  Omitted, the children follow the run — which is what the global Tools
   *  toggle has always done, and the only behaviour the bridge lane has. */
  expandChildren?: boolean
  /** The still-running call, when the turn is live (desktop parity). Null on
   *  the bridge lane, which has no per-call lifecycle to read. */
  activeCall?: NativeChatToolCallBlock | null
  /** Last accepted plan of each family from earlier messages, so a revision
   *  in this run diffs against the one before it, not only this run. */
  taskListPredecessors?: MobileTaskListPredecessors
  onOpenFile?: (relativePath: string) => void
  /** Put one hunk of a landed edit back, from its diff card. */
  onRevertHunk?: MobileNativeChatRevertHunk
  /** This run's place in its message (message id and segment), so each diff
   *  card under it has an identity beyond its content. */
  revertScope?: string
  /** Focus view: the row says only how many calls ran — no sentence, no
   *  argument, no plan line, no "Running" — until the reader unfolds it. The
   *  label holds while open too, so a tap does not make the row jump. */
  focusView?: boolean
  styles: ChatMessageStyles
}

function ToolRunView({
  blocks,
  defaultExpanded,
  expandChildren,
  activeCall = null,
  taskListPredecessors,
  onOpenFile,
  onRevertHunk,
  revertScope,
  focusView = false,
  styles
}: ToolRunProps) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(defaultExpanded)
  // The Claude-app detail sheet for whichever call was tapped, in this run or
  // one of its lines; null closes it. Kept local to the run rather than
  // threaded up through the message/view props that already carry
  // `onOpenFile` — nothing outside a run needs to know a sheet is open.
  const [detailPair, setDetailPair] = useState<ToolPair | null>(null)
  // Past the first six calls the body offers the rest behind a button; it
  // ended at plain "… N more tool calls" text, so calls 7 onward, a failed one
  // and its detail sheet included, could not be reached (review, 2026-09-30).
  const [showAllPairs, setShowAllPairs] = useState(false)
  const allPairs = pairToolBlocks(blocks)
  const pairs = showAllPairs ? allPairs : allPairs.slice(0, MAX_VISIBLE_TOOL_PAIRS)
  // Cheap enough to run collapsed: a plan row says how far along it is
  // before anyone opens it ("1/3 · Writing the test", beside the sentence).
  // Over every call, not only the ones shown: a plan made after the sixth
  // call drew no plan line, and a revision there no diff.
  const taskLists = mobileTaskListRows(allPairs, taskListPredecessors)
  let planPreview: string | null = null
  for (const row of taskLists) {
    if (row) {
      planPreview = mobileTaskListPreview(row.list)
    }
  }
  // Every line draws the diff budget of the run's first page: 240 rows over
  // the calls shown before "Show N more tool calls", two diffs a call, so 20
  // rows a diff once a run passes six calls. Worked out over the calls shown
  // at the time, the tap cut the diffs the reader was reading, to 10 rows for
  // 12 calls and 1 for 120 (review, 2026-09-30). The calls the tap reveals
  // draw the same 20 but come in closed, even under the expand-all toggle
  // (renderBody): opened together, 120 calls would draw thousands of rows at
  // once. So a run never draws more diff rows at once than its first page,
  // and every row past that is one the reader opened.
  const shownByDefault = Math.min(allPairs.length, MAX_VISIBLE_TOOL_PAIRS)
  const diffLineLimit = Math.max(
    1,
    Math.floor(MAX_TOOL_RUN_DIFF_ROWS / (shownByDefault * 2 || 1))
  )
  let callCount = 0
  for (const block of blocks) {
    if (block.type === 'tool-call') {
      callCount++
    }
  }
  // A run of nothing but results whose calls the window cut counts its rows,
  // all of them: over the six shown it said "6 tool calls" for seven.
  callCount ||= allPairs.length
  const countLabel = `${callCount} tool call${callCount === 1 ? '' : 's'}`
  // A collapsed run that contained failures says so (Orca #21151), counted
  // over every call, not the latest: in the sentence's "(N failed)", and a
  // quiet `N failed` in the header's muted type wherever the sentence might
  // not show it all (below). Text only — a tool error is routine work, so no danger tint.
  // This fork's header never drew a completion mark, so there was no false
  // one to withhold; the count is the half of the fix the phone can show.
  const { failedCallCount } = nativeChatToolRunOutcome(blocks, {
    activeTurnIsWorking: activeCall !== null
  })
  // docs/claude-app-parity.md item 3: the run's own "+A −R" chip. Detail
  // about what the tools did, like the sentence and the plan preview, so
  // focus view folds it away too.
  // A created file the wire cut is counted from the file on the desktop, when
  // that is provably the one the Write made (mobile-native-chat-created-file-count.ts),
  // and only once the run is done and draws a count: on its header, or on the
  // card inside it in focus view.
  const createdFileCount = useCreatedFileCounts(
    blocks,
    activeCall === null && (open || !focusView)
  )
  const diffStat = focusView ? null : toolRunDiffStat(blocks, createdFileCount)
  // The call's input, not its word: Codex names a classified shell row
  // `read`/`search`/`list` and keeps the command it ran, while Claude's `Read`
  // shares that word and ran none.
  const ActiveToolIcon = activeCall && isShellActivityToolCall(activeCall) ? SquareTerminal : Wrench
  // One disclosure mark on either header: down when open, right when closed.
  const Chevron = open ? ChevronDown : ChevronRight
  // A run of exactly one call IS that call's row — the Claude app shows a
  // run's calls first and opens the sheet per call, but with only one call
  // there is nothing to disclose first, so its header opens the sheet
  // directly instead of revealing a single child line to tap again. So does
  // a run that is one result whose call the window cut. Counted over every
  // row, not the ones shown: a run with rows behind "Show N more tool calls"
  // keeps the reveal-first behaviour, since it has more than one to disclose.
  // The Claude app's row for a run with an agent still working in it is
  // "Running agent ›" (`runningAgent`, read by RunningAgentGate), whatever
  // else the run did (2026-10-01 screenshots).
  const openRunSheet = useRunSheetOpener(blocks, revertScope)
  const singlePair = allPairs.length === 1 ? allPairs[0]! : null
  const singlePairOpensSheet =
    singlePair !== null && toolPairOpensDetailSheet(singlePair, { isTaskList: Boolean(taskLists[0]) })
  const detailSheet = (
    <MobileNativeChatToolDetailSheet pair={detailPair} onClose={() => setDetailPair(null)} />
  )
  if (activeCall) {
    return (
      <View style={styles.toolRun}>
        <View style={styles.toolRunHeader}>
          <Pressable
            testID="tool-run-active-header"
            style={styles.toolRunActive}
            onPress={() => setOpen((v) => !v)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLiveRegion="polite"
          >
            <ActiveToolIcon size={14} color={colors.textMuted} strokeWidth={2} />
            <ShimmerText
              text={focusView ? countLabel : 'Running'}
              active
              color={colors.textSecondary}
              style={styles.toolRunActiveLabel}
              numberOfLines={1}
              testID="tool-run-active-label"
            />
            <Chevron size={14} color={colors.textMuted} strokeWidth={2} />
          </Pressable>
        </View>
        {open ? renderBody() : null}
        {detailSheet}
      </View>
    )
  }
  // Given the run's own count, the sentence states no "(N failed)" when it
  // can count fewer failures than the run had (a folded Codex poll's error, a
  // call failed by its own state alone): "(1 failed)" beside "2 failed" was
  // two different counts for one run (review, 2026-09-30).
  const sentenceSpans = focusView ? [] : toolRunSentenceSpans(blocks, failedCallCount)
  // The sentence says "(N failed)" itself, as the Claude app's row does; a
  // second "N failed" beside it said it twice and cut the sentence
  // (2026-09-26). The label stays wherever the row might not show every
  // failure: focus view's bare count, an empty sentence, a sentence that
  // counted fewer failures than the run had and so states none, or one whose
  // count sits past what a phone row shows before its ellipsis (a
  // SendMessage's preview, a command's description).
  const sentenceShowsFailures =
    sentenceSpans.length > 0 && toolRunSentenceShowsFailures(blocks, failedCallCount)
  const hasAgentCall = !focusView && blocks.some((block) => isToolCallBlock(block) && isAgentToolName(block.name))
  return (
    <View style={styles.toolRun}>
      <RunningAgentGate blocks={blocks} enabled={hasAgentCall}>
        {(runningAgent, agentSubject) => {
          const sentenceStatesFailures = !runningAgent && sentenceShowsFailures
          return (
      <View style={styles.toolRunHeader}>
        <Pressable
          testID="tool-run-header"
          style={styles.toolRunToggle}
          onPress={() => {
            if (singlePairOpensSheet && singlePair) {
              setDetailPair(singlePair)
              return
            }
            // Two calls or more: the Claude app lists them in a sheet instead
            // of unfolding the row (2026-10-01 screenshots). The inline list
            // stays where the reader asked for it (the Tools toggle, the turn
            // caret, an open row, focus view) and where no chat provides the
            // sheet (a subagent's own transcript).
            if (!open && !focusView && allPairs.length >= 2 && openRunSheet) {
              // Counted in the sheet's rows, not the calls: a Codex poll folds
              // into the command it drives, so a command and its poll are one
              // row, and a one-row sheet is the call's own sheet.
              const rows = runSheetRows(blocks, [])
              const only = rows.length === 1 ? rows[0]!.pair : null
              if (only && toolPairOpensDetailSheet(only, { isTaskList: false })) {
                setDetailPair(only)
              } else {
                openRunSheet()
              }
              return
            }
            setOpen((v) => !v)
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={runningAgent ? runningAgentText(agentSubject) : undefined}
          accessibilityLiveRegion={runningAgent ? 'polite' : undefined}
        >
          {runningAgent ? (
            <>
              <AgentRunGlyph color={colors.textMuted} />
              <ShimmerText
                text={runningAgentText(agentSubject)}
                active
                color={colors.textSecondary}
                style={[styles.toolRunLabel, { flex: 0, flexShrink: 1 }]}
                numberOfLines={1}
                testID="tool-run-agent-label"
              />
            </>
          ) : (
            <ToolRunSentenceText
              spans={sentenceSpans}
              fallback={countLabel}
              style={[styles.toolRunLabel, styles.toolRunSentence]}
              styles={styles}
            />
          )}
          {planPreview && !focusView && !runningAgent ? (
            <Text testID="tool-run-member-arg" style={styles.toolRunMemberArg} numberOfLines={1}>
              {planPreview}
            </Text>
          ) : null}
          {failedCallCount > 0 && !sentenceStatesFailures && !runningAgent ? (
            <Text
              testID="tool-run-failed-count"
              accessibilityLabel={`Failed tool calls: ${failedCallCount}`}
              style={styles.toolRunMemberArg}
              numberOfLines={1}
            >
              {`${failedCallCount} failed`}
            </Text>
          ) : null}
          {diffStat && !runningAgent ? <ToolRunDiffChip stat={diffStat} styles={styles} /> : null}
          <Chevron size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>
          )
        }}
      </RunningAgentGate>
      {open ? renderBody() : null}
      {detailSheet}
    </View>
  )

  function renderBody(): React.JSX.Element {
    return (
      <View style={styles.toolRunBody}>
        {pairs.map((pair, i) => (
          <ToolLine
            key={i}
            pair={pair}
            taskList={taskLists[i] ?? null}
            // A call "Show N more" revealed opens on its own tap (diffLineLimit).
            defaultExpanded={i < MAX_VISIBLE_TOOL_PAIRS && (expandChildren ?? defaultExpanded)}
            diffLineLimit={diffLineLimit}
            onOpenFile={onOpenFile}
            onOpenDetail={setDetailPair}
            onRevertHunk={onRevertHunk}
            revertScope={`${revertScope ?? ''}:${i}`}
            createdFileCount={createdFileCount}
            styles={styles}
          />
        ))}
        {/* Rows, not calls: a result whose call the window cut is a row of
            its own, and counted by calls it hid the last call (2026-09-30). */}
        {allPairs.length > pairs.length ? (
          <ShowMoreCalls
            count={allPairs.length - pairs.length}
            onPress={() => setShowAllPairs(true)}
            styles={styles}
          />
        ) : null}
      </View>
    )
  }
}
