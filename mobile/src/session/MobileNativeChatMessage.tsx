import { memo, useContext, useState, type ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { Undo2 } from 'lucide-react-native'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import { inFlightToolCall } from './mobile-native-chat-in-flight-call'
import { isTextBlock } from '../../../src/shared/native-chat-types'
import { drawnNativeChatBlocks } from './mobile-native-chat-subagent-group-blocks'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { AgentControls, TurnActionsPlace, type TurnActionsAt } from './MobileNativeChatTurnActions'
import { copyFailedNotice } from '../components/use-copy-to-clipboard'
import { groupProseBlocks, imageFollowsImage, imageLeadsText } from './mobile-native-chat-prose-groups'
import { useMobileNativeChatMessageCopy } from './use-mobile-native-chat-message-copy'
import { renderProseGroup } from './mobile-native-chat-prose-group-view'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { nativeChatMessageText, nativeChatReplyPlainText } from './mobile-native-chat-message-text'
import { isPeerBoilerplateRow } from './mobile-native-chat-peer-messages'
import { MobileNativeChatPeerBoilerplateRow } from './MobileNativeChatPeerBoilerplateRow'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import { MobileNativeChatAgentMessageRow } from './MobileNativeChatAgentMessageRow'
import { MobileNativeChatReasoningNote } from './MobileNativeChatReasoningNote'
import { errorRowOf } from './mobile-native-chat-error-rows'
import type { TurnEditedFile } from './mobile-native-chat-turn-edits'
import { MobileNativeChatTurnEditsCard } from './MobileNativeChatTurnEditsCard'
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
import { takeUserUploads } from './mobile-native-chat-file-mentions'
import { MobileNativeChatUploadCardRow } from './MobileNativeChatFileCard'

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
    // Its own native view on Android, always. A View with only a fill and no
    // stacking context is a childless box there: Fabric mounts what it draws
    // one by one into the list cell beside it, so a queued prompt's bubble was
    // an empty filled rectangle with its words, its document and its controls
    // mounted next to it. That is the shape of the blank bubble seen over the
    // running turn's rows on 2026-10-14; the mount fault that left it there
    // was not caught. Always, not only with a fill: the copied tint must not
    // flip it.
    return (
      <View style={style} collapsable={false}>
        {children}
      </View>
    )
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

function MobileNativeChatMessageImpl({
  message,
  mayStillGrow = false,
  toolsExpanded = false,
  promptsAsMarkdown = false,
  fontScale = 1,
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
  copyTurnText,
  anchorsTurnActions = false,
  turnTrailingWork,
  turnIsNewest = false,
  turnEdits,
  subagentGroupsOpen,
  onToggleSubagentGroup
}: {
  message: NativeChatMessage
  /** The newest assistant row of a live turn with no prompt open: its last text may still grow. */
  mayStillGrow?: boolean
  toolsExpanded?: boolean
  /** A transcript whose user rows the lead agent wrote (a subagent's task),
   *  drawn as Markdown, as a reply is. The user's own prompts are drawn as
   *  Markdown only when written in it (userTextDrawsAsMarkdown), with their
   *  line breaks kept. */
  promptsAsMarkdown?: boolean
  /** Present while this optimistic echo is still queued behind a running turn. */
  onCancelQueued?: () => void
  /** Rewind the conversation to before this sent prompt. The lane passes it
   *  only for a journalled user message on a host that will rewind; the row
   *  never decides that for itself. Conversation only, never files. */
  onRewindToHere?: (messageId: string) => void
  /** Multiplies all chat text sizes for pinch-to-zoom (1 = no change). */
  fontScale?: number
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
  /** Whether this is the last message of the agent's turn. Its actions (copy)
   *  are drawn once, under the turn's end, as the Claude app
   *  does, not under every message of it (2026-10-09), unless work after the
   *  turn's last words still runs (anchorsTurnActions). The list says it; a
   *  surface that does not (a subagent's transcript) keeps them on each. */
  endsTurn?: boolean
  /** Whether any row of the turn this row ends has words: its Copy copies the
   *  whole reply, so a turn end with none of its own still offers it. Absent,
   *  the row's own words decide. */
  turnHasProse?: boolean
  /** The whole reply this row ends, as Copy gives it, asked for only on a tap.
   *  Absent, Copy copies this row alone (a subagent's transcript). */
  copyTurnText?: (messageId: string) => string
  /** This row holds its turn's last words. While the work after them still
   *  runs, the turn's actions are drawn here, right under those words and
   *  above the work, as the Claude app keeps them (2026-10-11); the row that
   *  ends the turn then draws none. */
  anchorsTurnActions?: boolean
  /** The turn's tool calls and results after its last words. Absent, the
   *  actions stay at the turn's end (a surface that names no turns). */
  turnTrailingWork?: readonly NativeChatBlock[]
  /** Whether this row's turn is the newest in the list, so the agent's
   *  working state speaks for it. */
  turnIsNewest?: boolean
  /** The files this row's turn changed, given only to the row that ends it:
   *  the turn edits card is drawn under it once the turn is over. */
  turnEdits?: readonly TurnEditedFile[]
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

  // A failed or stopped turn is drawn as the Claude app draws it: its own row
  // in the danger colour, not the agent's prose with a Copy under it.
  const errorRow = errorRowOf(message)
  if (errorRow) {
    return (
      <View style={styles.row}>
        <MobileNativeChatNoticeRow block={{ type: 'text', text: errorRow.text, tone: 'error' }} fontScale={fontScale} />
      </View>
    )
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
  // A prompt's uploads leave its text for their own row of cards above the
  // bubble, as the Claude app draws them; the bubble keeps only the words.
  const { cards: uploads, blocks: drawn } = isUser
    ? takeUserUploads(drawnNativeChatBlocks(message.blocks))
    : { cards: [], blocks: drawnNativeChatBlocks(message.blocks) }
  const uploadsOnly = uploads.length > 0 && drawn.length === 0 && !onCancelQueued
  const segments = splitTurnIntoSegments(drawn)
  // Still needed whole: the active call is chosen across the turn, and whether
  // any work ran at all decides the settled-tools rule below. A call with its
  // result is never the active one (mobile-native-chat-in-flight-call.ts).
  const { tools } = splitNativeChatBlocks(message.blocks)
  const activeCall = structuredActivityUi
    ? inFlightToolCall(tools, { activeTurnIsWorking })
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
  const hasProse = nativeChatMessageText(drawn) !== ''
  // The Copy under a turn's end copies the whole reply, as the Claude app's
  // does: one Copy under a text, tool, text turn copied only "Done." (review,
  // 2026-10-09), and the earlier words had no Copy of their own any more.
  const copiesTurn = isAgent && copyTurnText !== undefined
  const copyable = copiesTurn ? (turnHasProse ?? hasProse) : hasProse
  const handleCopy = (): void => {
    // A prompt copies as typed, Markdown source and all, even where it is
    // drawn formatted: the hold is the user's own words back. Only the
    // subagent transcript's task prompts (promptsAsMarkdown) copy what they
    // draw, like a reply.
    const text = copiesTurn
      ? copyTurnText(message.id)
      : isUser && !promptsAsMarkdown
        ? nativeChatMessageText(drawn)
        : nativeChatReplyPlainText(drawn)
    if (!text) {
      return
    }
    copy(text)
  }
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
    isAgent && copyable ? (
      <AgentControls onCopy={handleCopy} styles={styles} />
    ) : null
  // Where the turn's actions go. The Claude app hangs them off the turn's last
  // words and moves them under the work only once the turn is over (its
  // `result`); while work after the words still runs, they stay above it.
  // Ours drew Copy under a still-running shell, below the words it copies
  // (2026-10-11). Only a row the list names as placing them (the turn's end,
  // or the row with its last words) has a choice to make; each of its two
  // places reads the running state for itself (TurnActionsPlace), so no
  // other row subscribes to it.
  const choosesPlace = isAgent && turnTrailingWork !== undefined && (endsTurn || anchorsTurnActions)
  const lastWordsSegment =
    choosesPlace && anchorsTurnActions
      ? segments.findLastIndex((segment) => segment.kind === 'prose' && nativeChatMessageText(segment.blocks) !== '')
      : -1
  const placeAt = (at: TurnActionsAt): ReactNode =>
    choosesPlace ? (
      <TurnActionsPlace
        at={at}
        controls={controls}
        work={turnTrailingWork}
        turnIsNewest={turnIsNewest}
        endsTurn={endsTurn}
        hasWordsPlace={lastWordsSegment !== -1}
        styles={styles}
      />
    ) : at === 'end' && endsTurn && controls ? (
      <View style={styles.agentControlsRow}>{controls}</View>
    ) : null
  const endControls = isAgent ? placeAt('end') : null

  return (
    <>
      <View style={[styles.row, isUser && styles.rowUser]}>
        {uploads.length > 0 ? <MobileNativeChatUploadCardRow cards={uploads} onOpen={onOpenFile} /> : null}
        {/* A prompt that was only uploads has no words to hold. */}
        {uploadsOnly ? null : <Bubble
          user={isUser && !onCancelQueued}
          onToggle={() => setPromptControlsShown((shown) => !shown)}
          onCopy={hasProse ? handleCopy : undefined}
          style={[styles.content, isUser && styles.userBubble, copied && styles.copied]}
        >
          {segments.map((segment, segmentIndex) =>
            segment.kind === 'prose' ? (
              // No line beside the agent's own words, interim or final
              // (2026-09-25). A thought is its own "Thought process" row.
              <View key={`p${segmentIndex}`}>
                {groupProseBlocks(segment.blocks).map((group, index, groups) => (
                  // Air between a picture and the caption under it, and
                  // between pictures that follow each other.
                  <View
                    key={index}
                    style={[
                      imageLeadsText(groups, index) ? styles.imageLead : null,
                      imageFollowsImage(groups, index) ? styles.imageAfterImage : null
                    ]}
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
                {/* Under the turn's last words, above the work still running after them. */}
                {segmentIndex === lastWordsSegment ? placeAt('words') : null}
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
                inNewestReply={mayStillGrow}
                styles={styles}
              />
            ) : null
          )}
          {showToolRun ? (
            endControls
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
          ) : endControls ? (
            // Under the turn's last block, at the text's own edge.
            endControls
          ) : (
            sentPromptControls
          )}
        </Bubble>}
        {isAgent && endsTurn && turnEdits && turnEdits.length > 0 ? (
          <MobileNativeChatTurnEditsCard
            files={turnEdits}
            turnIsNewest={turnIsNewest}
            trailingWork={turnTrailingWork}
            styles={styles}
          />
        ) : null}
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
