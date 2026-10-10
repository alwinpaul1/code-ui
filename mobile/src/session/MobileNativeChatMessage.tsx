import { memo, useContext, useState, type ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { ArrowUp, Copy, Undo2 } from 'lucide-react-native'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { isTextBlock } from '../../../src/shared/native-chat-types'
import { withoutSubagentGroupTwins } from '../../../src/shared/native-chat-subagent-summary'
import { withDrawableSubagentGroups } from './mobile-native-chat-subagent-group-blocks'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { copyFailedNotice } from '../components/use-copy-to-clipboard'
import { groupProseBlocks, imageLeadsText } from './mobile-native-chat-prose-groups'
import { useMobileNativeChatMessageCopy } from './use-mobile-native-chat-message-copy'
import { renderProseGroup } from './mobile-native-chat-prose-group-view'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  useChatMessageStyles,
  type ChatMessageStyles
} from './mobile-native-chat-message-styles'
import { nativeChatMessageText, nativeChatReplyPlainText } from './mobile-native-chat-message-text'
import { isPeerBoilerplateRow } from './mobile-native-chat-peer-messages'
import { MobileNativeChatPeerBoilerplateRow } from './MobileNativeChatPeerBoilerplateRow'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import { MobileNativeChatAgentMessageRow } from './MobileNativeChatAgentMessageRow'
import { MobileNativeChatReasoningNote } from './MobileNativeChatReasoningNote'
import { MobileNativeChatToolSegment } from './MobileNativeChatToolSegment'
import type { MobileTaskListPredecessors } from './mobile-native-chat-task-list-rows'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import {
  isRenderableNativeChatNotice,
  MobileNativeChatNoticeRow
} from './MobileNativeChatNoticeRow'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'
import { MobileNativeChatVisualContext } from './mobile-native-chat-visual-context'

/** A finger held this long is a copy, not a tap: Android's own long-press
 *  timeout, the one the chat's scroll gate already keys on. */
const HOLD_TO_COPY_MS = 400

/** The message container: a sent prompt is tappable (it discloses its
 *  controls) and copies itself on a hold (2026-09-21: "automatic copy on
 *  long hold instead of long hold and copy button"); everything else is a
 *  plain view so nothing steals its touches. */
function Bubble({
  user,
  onToggle,
  onCopy,
  style,
  children
}: {
  user: boolean
  onToggle: () => void
  /** Absent when the prompt holds no text: a hold would copy nothing. */
  onCopy?: () => void
  style: StyleProp<ViewStyle>
  children: ReactNode
}) {
  if (!user) {
    return <View style={style}>{children}</View>
  }
  return (
    <Pressable
      style={style}
      onPress={onToggle}
      onLongPress={onCopy}
      delayLongPress={HOLD_TO_COPY_MS}
      accessibilityRole="button"
      accessibilityLabel="Sent prompt"
      accessibilityHint={onCopy ? 'Hold to copy' : undefined}
    >
      {children}
    </Pressable>
  )
}

/** Subtle controls under the end of an agent turn: copy the reply's prose, or
 *  scroll so the reply's first row aligns to the top of the viewport (where a
 *  surface names no turns, the message's own). No Copy without prose to copy:
 *  under a message made only of tool calls a tap copied nothing and said
 *  nothing, a dead button (review, 2026-09-30). */
function AgentControls({
  onCopy,
  onScrollToTop,
  styles
}: {
  onCopy?: () => void
  onScrollToTop?: () => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.controls}>
      {onCopy ? (
        <Pressable
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          onPress={onCopy}
          hitSlop={8}
          accessibilityLabel="Copy message"
        >
          <Copy size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      ) : null}
      {onScrollToTop ? (
        <Pressable
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          onPress={onScrollToTop}
          hitSlop={8}
          accessibilityLabel="Scroll this message to top"
        >
          <ArrowUp size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  )
}

function MobileNativeChatMessageImpl({
  message,
  mayStillGrow = false,
  toolsExpanded = false,
  promptsAsMarkdown = false,
  fontScale = 1,
  messageIndex,
  onScrollToMessage,
  onOpenFile,
  onRevertHunk,
  focusView = false,
  onCancelQueued,
  onRewindToHere,
  turnStatus,
  turnExpanded,
  turnKey,
  onToggleTurn,
  activeTurnIsWorking,
  structuredActivityUi = false,
  turnActivity = null,
  taskListPredecessors,
  endsTurn = true,
  turnHasProse,
  turnStartIndex,
  copyTurnText,
  subagentGroupsOpen,
  onToggleSubagentGroup
}: {
  message: NativeChatMessage
  /** The newest assistant row of a live turn with no prompt open: its last text may still grow. */
  mayStillGrow?: boolean
  toolsExpanded?: boolean
  /** A transcript whose user rows the lead agent wrote (a subagent's task),
   *  drawn as Markdown; the user's own prompts stay the plain text they typed. */
  promptsAsMarkdown?: boolean
  /** Present while this optimistic echo is still queued behind a running turn. */
  onCancelQueued?: () => void
  /** Rewind the conversation to before this sent prompt. The lane passes it
   *  only for a journalled user message on a host that will rewind; the row
   *  never decides that for itself. Conversation only, never files. */
  onRewindToHere?: (messageId: string) => void
  /** Multiplies all chat text sizes for pinch-to-zoom (1 = no change). */
  fontScale?: number
  /** This message's index in the list, paired with onScrollToMessage. */
  messageIndex?: number
  /** Ask the list to align this message's top to the top of the viewport. */
  onScrollToMessage?: (index: number) => void
  onOpenFile?: (relativePath: string) => void
  /** Put one hunk of a landed edit back, from its diff card. */
  onRevertHunk?: MobileNativeChatRevertHunk
  /** Focus view: each run of tool calls folds to its call count. */
  focusView?: boolean
  /** This turn's status row, rendered under a user message (desktop parity). */
  turnStatus?: NativeChatTurnStatus | null
  /** Whether the turn caret has disclosed this turn's activity. */
  turnExpanded?: boolean
  /** Set only when this row's turn has settled and can disclose its activity. */
  turnKey?: string
  /** Stable across renders; the row supplies its own key when tapped. */
  onToggleTurn?: (turnKey: string) => void
  /** Session-level working state for this message's turn; gates the live tool row. */
  activeTurnIsWorking?: boolean
  /** Last accepted plan of each family from earlier messages. */
  taskListPredecessors?: MobileTaskListPredecessors
  /** Structured lane only: live tool progress plus the turn-status disclosure. */
  structuredActivityUi?: boolean
  turnActivity?: { kind: 'description'; text: string } | null
  /** Whether this is the last message of the agent's turn. Its actions (copy,
   *  scroll to top) are drawn once, under the turn's end, as the Claude app
   *  does, not under every message of it (2026-10-09). The list says it; a
   *  surface that does not (a subagent's transcript) keeps them on each. */
  endsTurn?: boolean
  /** Whether any row of the turn this row ends has words: its Copy copies the
   *  whole reply, so a turn end with none of its own still offers it. Absent,
   *  the row's own words decide. */
  turnHasProse?: boolean
  /** The list index of the first row of the turn this row ends. The arrow
   *  brings the start of the reply to the top, not this last row of it.
   *  Absent, it brings this row. */
  turnStartIndex?: number
  /** The whole reply this row ends, as Copy gives it, asked for only on a tap.
   *  Absent, Copy copies this row alone (a subagent's transcript). */
  copyTurnText?: (messageId: string) => string
  /** The spawn groups the reader opened, held by the transcript so a remounted row keeps them;
   *  only a row holding a roster gets it (Orca #26125). */
  subagentGroupsOpen?: ReadonlySet<string>
  onToggleSubagentGroup?: (groupId: string) => void
}) {
  const styles = useChatMessageStyles()
  const { colors } = useTheme()
  const isUser = message.role === 'user'
  const isReasoning = message.role === 'reasoning'
  const isAgent = !isUser
  // Briefly tint the bubble once a copy landed; say so when it did not.
  const { copied, error: copyError, copy } = useMobileNativeChatMessageCopy()
  // A sent prompt shows its copy control only once tapped, so the bubble
  // stays clean; a queued echo keeps its Queued/Cancel row instead.
  const [promptControlsShown, setPromptControlsShown] = useState(false)
  // A structured chat's `::orca-visual` lines, in assistant replies only (Orca #26071).
  const transcriptVisuals = useContext(MobileNativeChatVisualContext) ?? undefined
  const renderVisual = message.role === 'assistant' ? transcriptVisuals : undefined
  // Structured replies grow in place: only the last block of the newest row may still be typing.
  const growingBlock =
    renderVisual && mayStillGrow && activeTurnIsWorking === true ? message.blocks.at(-1) : undefined

  if (isReasoning) {
    return <MobileNativeChatReasoningNote message={message} fontScale={fontScale} onOpenFile={onOpenFile} styles={styles} />
  }

  // The harness's words around a peer message, as the Claude app draws them.
  if (isPeerBoilerplateRow(message)) {
    return <MobileNativeChatPeerBoilerplateRow message={message} fontScale={fontScale} styles={styles} />
  }

  // A subagent's message to this session, folded as the desktop TUI folds it.
  const agentMessage = agentMessageOf(message)
  if (agentMessage) {
    return <MobileNativeChatAgentMessageRow {...agentMessage} fontScale={fontScale} onOpenFile={onOpenFile} styles={styles} />
  }

  // A host-authored notice — a compaction boundary, a plan document, a toned
  // line — is not something the agent said, so it never gets a bubble or the
  // copy/scroll controls. An unknown hint falls through to ordinary prose.
  const notice =
    message.role === 'system'
      ? message.blocks.find((block) => isTextBlock(block) && isRenderableNativeChatNotice(block))
      : undefined
  if (notice !== undefined && isTextBlock(notice)) {
    return (
      <View style={styles.row}>
        <MobileNativeChatNoticeRow block={notice} fontScale={fontScale} onOpenFile={onOpenFile} />
      </View>
    )
  }

  // A turn is drawn in the order it HAPPENED: runs of words and runs of work,
  // interleaved as the transcript recorded them. Bucketing all prose above all
  // tools — which is what `splitNativeChatBlocks` does — put a reply written
  // before a command underneath it, and a reply written after it above; the
  // words lost their place relative to the work (reported 2026-09-15 against
  // the terminal, which shows the true order). The user's own messages still
  // get a soft bubble so they stand apart from agent prose.
  // A roster the row can draw replaces the frozen sentence the host wrote beside it (#26125).
  const segments = splitTurnIntoSegments(withoutSubagentGroupTwins(withDrawableSubagentGroups(message.blocks)))
  // Still needed whole: the active call is chosen across the turn, and whether
  // any work ran at all decides the settled-tools rule below.
  const { tools } = splitNativeChatBlocks(message.blocks)
  const activeCall = structuredActivityUi
    ? selectActiveToolCall(tools, { activeTurnIsWorking })
    : null
  // A completed turn's activity belongs behind the turn-status caret. Leaving the
  // grouped row visible made a failed child command read as a failed response.
  // The composer's global Tools toggle still overrides this, or it would silently
  // do nothing on every settled turn.
  const settledToolsHidden =
    structuredActivityUi &&
    activeCall == null &&
    activeTurnIsWorking === false &&
    !turnExpanded &&
    !toolsExpanded
  const showToolRun = tools.length > 0 && !settledToolsHidden
  // Whether there is any prose to copy, without parsing it: only a tap pays
  // for the Markdown-to-text pass. Text that draws as nothing (an image-only
  // Markdown line) still passes this and copies nothing when tapped.
  const hasProse = nativeChatMessageText(message.blocks) !== ''
  // The Copy under a turn's end copies the whole reply, as the Claude app's
  // does: one Copy under a text, tool, text turn copied only "Done." (review,
  // 2026-10-09), and the earlier words had no Copy of their own any more.
  const copiesTurn = isAgent && copyTurnText !== undefined
  const copyable = copiesTurn ? (turnHasProse ?? hasProse) : hasProse
  const handleCopy = (): void => {
    // A prompt copies as typed, unless it is drawn as Markdown (the subagent
    // transcript's task prompts); then it copies what it draws, like a reply.
    const text = copiesTurn
      ? copyTurnText(message.id)
      : isUser && !promptsAsMarkdown
        ? nativeChatMessageText(message.blocks)
        : nativeChatReplyPlainText(message.blocks)
    if (!text) {
      return
    }
    copy(text)
  }
  // The start of the reply, as the arrow under each row once meant for its own
  // row: now that only a turn's last row has the arrow, aiming at that row
  // lined up its last words ("Done.") instead of where the reply began.
  const scrollTarget = turnStartIndex ?? messageIndex
  const scrollToTop =
    onScrollToMessage && scrollTarget !== undefined ? () => onScrollToMessage(scrollTarget) : undefined

  // Only Rewind lives here now; with no lane to rewind, a tap discloses
  // nothing rather than an empty row.
  const sentPromptControls =
    isUser && !onCancelQueued && promptControlsShown && onRewindToHere ? (
      <View style={styles.controlsRow}>
        {onRewindToHere ? (
          <Pressable
            style={({ pressed }) => [styles.rewindControl, pressed && styles.controlPressed]}
            onPress={() => onRewindToHere(message.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Rewind to here"
          >
            <Undo2 size={14} color={colors.userBubbleText} strokeWidth={2} />
            <Txt variant="caption" weight="semibold" style={{ color: colors.userBubbleText }}>
              Rewind to here
            </Txt>
          </Pressable>
        ) : null}
      </View>
    ) : null

  const controls =
    isAgent && endsTurn && (copyable || scrollToTop) ? (
      <AgentControls onCopy={copyable ? handleCopy : undefined} onScrollToTop={scrollToTop} styles={styles} />
    ) : null

  return (
    <>
      <View style={[styles.row, isUser && styles.rowUser]}>
        <Bubble
          user={isUser && !onCancelQueued}
          onToggle={() => setPromptControlsShown((shown) => !shown)}
          onCopy={hasProse ? handleCopy : undefined}
          style={[styles.content, isUser && styles.userBubble, copied && styles.copied]}
        >
          {segments.map((segment, segmentIndex) =>
            segment.kind === 'prose' ? (
              // No line beside the agent's own words, interim or final: the
              // Claude app draws one only beside a thought (2026-09-25).
              <View key={`p${segmentIndex}`}>
                {groupProseBlocks(segment.blocks, { isUser }).map((group, index, groups) => (
                  // Air between a picture and the caption under it.
                  <View
                    key={index}
                    style={imageLeadsText(groups, index) ? styles.imageLead : null}
                  >
                    {renderProseGroup(group, {
                      isUser,
                      promptsAsMarkdown,
                      fontScale,
                      onOpenFile,
                      styles,
                      // The list recycles a row's cell for other messages;
                      // this names the block for its markdown.
                      identity: `${message.id}:${segmentIndex}:${index}`,
                      renderVisual,
                      holdPendingVisual: group.type === 'block' && group.block === growingBlock,
                      subagentGroupsOpen,
                      onToggleSubagentGroup
                    })}
                  </View>
                ))}
              </View>
            ) : showToolRun ? (
              <MobileNativeChatToolSegment
                // Why: a global toggle intentionally resets all per-run/per-line
                // overrides in one remount, avoiding an effect-driven second render.
                // Focus view is such a toggle: switching it folds every run back.
                key={`t${segmentIndex}:${toolsExpanded ? 'expanded' : 'collapsed'}:${turnExpanded ? 'turn' : 'flat'}:${focusView ? 'focus' : 'full'}`}
                blocks={segment.blocks}
                defaultExpanded={turnExpanded || toolsExpanded}
                expandChildren={turnExpanded ? false : toolsExpanded}
                // The active call lives in whichever run holds it; the others
                // are handed it and simply do not match.
                activeCall={activeCall}
                taskListPredecessors={taskListPredecessors}
                onOpenFile={onOpenFile}
                onRevertHunk={onRevertHunk}
                revertScope={`${message.id}:${segmentIndex}`}
                focusView={focusView}
                styles={styles}
              />
            ) : null
          )}
          {showToolRun ? (
            controls ? <View style={styles.agentControlsRow}>{controls}</View> : null
          ) : onCancelQueued ? (
            <View style={styles.controlsRow}>
              <Txt variant="caption" tone="inverse" style={{ opacity: 0.7 }}>
                Queued
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel queued message"
                hitSlop={8}
                onPress={onCancelQueued}
                style={({ pressed }) => ({ marginLeft: 12, opacity: pressed ? 0.5 : 1 })}
              >
                <Txt variant="caption" weight="semibold" tone="danger">
                  Cancel
                </Txt>
              </Pressable>
            </View>
          ) : controls ? (
            // Under the turn's last block, at the text's own edge.
            <View style={styles.agentControlsRow}>{controls}</View>
          ) : (
            sentPromptControls
          )}
        </Bubble>
        {/* Under the bubble, in the page's ink rather than the bubble's. */}
        {copyError ? (
          <Txt variant="caption" tone="danger" style={{ marginTop: 4 }} accessibilityLiveRegion="polite">
            {copyFailedNotice(copyError)}
          </Txt>
        ) : null}
      </View>
      {turnStatus ? (
        <MobileNativeChatTurnStatus
          startedAt={turnStatus.startedAt}
          thinking={turnStatus.thinking}
          workedSeconds={turnStatus.workedSeconds}
          verdict={turnStatus.verdict}
          expanded={turnExpanded ?? false}
          onToggleExpanded={turnKey && onToggleTurn ? () => onToggleTurn(turnKey) : undefined}
          activityText={turnStatus.workedSeconds == null ? (turnActivity?.text ?? undefined) : undefined}
        />
      ) : null}
    </>
  )
}

export const MobileNativeChatMessage = memo(MobileNativeChatMessageImpl)
