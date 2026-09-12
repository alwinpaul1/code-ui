import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Sparkles
} from 'lucide-react-native'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { isTextBlock } from '../../../src/shared/native-chat-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { Prose } from './MobileNativeChatProse'
import { MobileNativeChatImageStrip } from './MobileNativeChatImageStrip'
import { groupProseBlocks } from './mobile-native-chat-prose-groups'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  useChatMessageStyles,
  type ChatMessageStyles
} from './mobile-native-chat-message-styles'
import { nativeChatMessageText } from './mobile-native-chat-message-text'
import { ToolRun } from './MobileNativeChatToolRun'
import type { MobileTaskListPredecessors } from './mobile-native-chat-task-list-rows'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import {
  isRenderableNativeChatNotice,
  MobileNativeChatNoticeRow
} from './MobileNativeChatNoticeRow'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'

/** Collapsed reasoning shows this many characters of its first line. */
const REASONING_PREVIEW_CHARS = 96

/** The message container: a sent prompt is tappable (it discloses its copy
 *  control); everything else is a plain view so nothing steals its touches. */
function Bubble({
  user,
  onToggle,
  style,
  children
}: {
  user: boolean
  onToggle: () => void
  style: StyleProp<ViewStyle>
  children: ReactNode
}) {
  if (!user) {
    return <View style={style}>{children}</View>
  }
  return (
    <Pressable style={style} onPress={onToggle} accessibilityRole="button" accessibilityLabel="Sent prompt">
      {children}
    </Pressable>
  )
}

/** Subtle controls for an agent message: copy its prose, or scroll so this
 *  message's top aligns to the top of the viewport. */
function AgentControls({
  onCopy,
  onScrollToTop,
  styles
}: {
  onCopy: () => void
  onScrollToTop?: () => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.controls}>
      <Pressable
        style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        onPress={onCopy}
        hitSlop={8}
        accessibilityLabel="Copy message"
      >
        <Copy size={14} color={colors.textMuted} strokeWidth={2} />
      </Pressable>
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

/** Reasoning turns fold into a "Thinking" disclosure so a long think-aloud does
 *  not swamp the transcript (#17579). Collapsed shows one preview line. */
function ReasoningDisclosure({
  message,
  fontScale,
  onOpenFile,
  styles
}: {
  message: NativeChatMessage
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const text = nativeChatMessageText(message.blocks)
  const preview =
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  const truncated =
    preview.length > REASONING_PREVIEW_CHARS
      ? `${preview.slice(0, REASONING_PREVIEW_CHARS).trimEnd()}…`
      : preview
  return (
    <View style={styles.reasoning}>
      <Pressable
        style={styles.reasoningHeader}
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide thinking' : 'Show thinking'}
      >
        <Sparkles size={13} color={colors.textMuted} strokeWidth={2} />
        <Txt variant="caption" weight="semibold" tone="muted">
          Thinking
        </Txt>
        {open ? (
          <ChevronDown size={13} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <ChevronRight size={13} color={colors.textMuted} strokeWidth={2} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.reasoningBody}>
          <MobileMarkdown content={text} textScale={fontScale * 0.93} onOpenFile={onOpenFile} />
        </View>
      ) : truncated ? (
        <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {truncated}
        </Txt>
      ) : null}
    </View>
  )
}

function MobileNativeChatMessageImpl({
  message,
  interim = false,
  toolsExpanded = false,
  fontScale = 1,
  messageIndex,
  onScrollToMessage,
  onOpenFile,
  onCancelQueued,
  turnStatus,
  turnExpanded,
  turnKey,
  onToggleTurn,
  activeTurnIsWorking,
  structuredActivityUi = false,
  turnActivity = null,
  taskListPredecessors
}: {
  message: NativeChatMessage
  /** An assistant note the agent kept working past, drawn as a quote block
   *  with a bar on the left, the way the Claude app draws it (2026-09-12). */
  interim?: boolean
  toolsExpanded?: boolean
  /** Present while this optimistic echo is still queued behind a running turn. */
  onCancelQueued?: () => void
  /** Multiplies all chat text sizes for pinch-to-zoom (1 = no change). */
  fontScale?: number
  /** This message's index in the list, paired with onScrollToMessage. */
  messageIndex?: number
  /** Ask the list to align this message's top to the top of the viewport. */
  onScrollToMessage?: (index: number) => void
  onOpenFile?: (relativePath: string) => void
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
}) {
  const styles = useChatMessageStyles()
  const { colors } = useTheme()
  const isUser = message.role === 'user'
  const isReasoning = message.role === 'reasoning'
  const isAgent = !isUser
  // Briefly tint the bubble to confirm a copy landed.
  const [copied, setCopied] = useState(false)
  // A sent prompt shows its copy control only once tapped, so the bubble
  // stays clean; a queued echo keeps its Queued/Cancel row instead.
  const [promptControlsShown, setPromptControlsShown] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
    },
    []
  )

  if (isReasoning) {
    return (
      <View style={styles.row}>
        <ReasoningDisclosure
          message={message}
          fontScale={fontScale}
          onOpenFile={onOpenFile}
          styles={styles}
        />
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

  // Separate the agent's words from its tool activity: prose renders first, the
  // tool calls fold into a collapsible run beneath. The user's own messages get
  // a soft bubble so they stand apart from agent prose.
  const { prose, tools } = splitNativeChatBlocks(message.blocks)
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

  const handleCopy = (): void => {
    const text = nativeChatMessageText(message.blocks)
    if (!text) {
      return
    }
    void Clipboard.setStringAsync(text)
    setCopied(true)
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
    }
    copyTimer.current = setTimeout(() => setCopied(false), 700)
  }

  const sentPromptControls =
    isUser && !onCancelQueued && promptControlsShown ? (
      <View style={styles.controlsRow}>
        <Pressable
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          onPress={handleCopy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Copy prompt"
        >
          <Copy size={14} color={colors.userBubbleText} strokeWidth={2} />
        </Pressable>
      </View>
    ) : null

  const controls = isAgent ? (
    <AgentControls
      onCopy={handleCopy}
      onScrollToTop={
        onScrollToMessage && messageIndex !== undefined
          ? () => onScrollToMessage(messageIndex)
          : undefined
      }
      styles={styles}
    />
  ) : null

  return (
    <>
      <View style={[styles.row, isUser && styles.rowUser]}>
        <Bubble
          user={isUser && !onCancelQueued}
          onToggle={() => setPromptControlsShown((shown) => !shown)}
          style={[styles.content, isUser && styles.userBubble, copied && styles.copied]}
        >
          <View style={interim && isAgent ? styles.interimNote : null}>
            {groupProseBlocks(prose).map((group, index) =>
              group.type === 'image-strip' ? (
                <MobileNativeChatImageStrip
                  key={index}
                  uris={group.uris}
                  label={group.alt}
                  styles={styles}
                />
              ) : (
                <Prose
                  key={index}
                  block={group.block}
                  invert={isUser}
                  fontScale={fontScale}
                  onOpenFile={onOpenFile}
                  styles={styles}
                />
              )
            )}
          </View>
          {showToolRun ? (
            <ToolRun
              // Why: a global toggle intentionally resets all per-run/per-line
              // overrides in one remount, avoiding an effect-driven second render.
              key={`${toolsExpanded ? 'expanded' : 'collapsed'}:${turnExpanded ? 'turn' : 'flat'}`}
              blocks={tools}
              defaultExpanded={turnExpanded || toolsExpanded}
              expandChildren={turnExpanded ? false : toolsExpanded}
              activeCall={activeCall}
              taskListPredecessors={taskListPredecessors}
              trailing={controls}
              onOpenFile={onOpenFile}
              styles={styles}
            />
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
            <View style={styles.controlsRow}>{controls}</View>
          ) : (
            sentPromptControls
          )}
        </Bubble>
      </View>
      {turnStatus ? (
        <MobileNativeChatTurnStatus
          startedAt={turnStatus.startedAt}
          thinking={turnStatus.thinking}
          workedSeconds={turnStatus.workedSeconds}
          expanded={turnExpanded ?? false}
          onToggleExpanded={turnKey && onToggleTurn ? () => onToggleTurn(turnKey) : undefined}
          activityText={turnStatus.workedSeconds == null ? (turnActivity?.text ?? undefined) : undefined}
        />
      ) : null}
    </>
  )
}

export const MobileNativeChatMessage = memo(MobileNativeChatMessageImpl)
