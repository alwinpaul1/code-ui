import { ChevronRight } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { useTheme } from '../theme/theme-context'
import { ClaudeRollingText } from './ClaudeRollingText'
import { ClaudeFooterSeparator } from './ClaudeFooterSeparator'
import { ClaudeWorkingMark } from './ClaudeWorkingMark'
import type { WorkingMarkKind } from './claude-working-mark'
import {
  CLAUDE_FOOTER_IDLE_MIN_WIDTH,
  CLAUDE_FOOTER_MARK_GAP,
  CLAUDE_FOOTER_PADDING_HORIZONTAL,
  CLAUDE_FOOTER_PADDING_VERTICAL,
  CLAUDE_FOOTER_SEPARATOR
} from './claude-working-footer-spec'
import { formatRunningTaskCount } from './mobile-background-task-labels'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import { useNativeChatTasks } from './native-chat-tasks-context'
import { useClaudeWorkingVerb } from './use-claude-working-verb'
import { useClaudeChatLive } from './claude-chat-live'
import type { ClaudeFooterLiveInput } from './claude-working-footer-stats'
import { useClaudeFooterStats } from './use-claude-footer-stats'
import { useNativeChatConnectionNotice } from './native-chat-connection-notice'
import { ShimmerText } from './MobileNativeChatShimmerText'
import {
  CLAUDE_TOOL_ROW_CHEVRON_GAP,
  CLAUDE_TOOL_ROW_CHEVRON_SIZE,
  CLAUDE_TOOL_ROW_CLOCK_GAP,
  CLAUDE_TOOL_ROW_RADIUS
} from './claude-live-tool-row'

/** The live tool row's content (`r0x`, claude-live-tool-row.ts), as MobileNativeChatWorkingFooter
 *  builds it. */
export type ClaudeLiveToolRowView = {
  callId: string
  /** "Running pnpm test", "Reading file.ts". */
  label: string
  /** "12s", or null under 2 s or while the call awaits approval. */
  clock: string | null
  /** The label shimmers (`isLoading`: the header is Working, not AwaitingApproval). */
  loading: boolean
  /** A path-like tool's label is cut in the middle, keeping the file name's end. */
  middleEllipsis: boolean
  /** Opens the call's detail sheet; the row is a button with a chevron when set. */
  onPress: (() => void) | null
}

/**
 * The working line at the foot of the transcript, as the Claude app draws it (com.anthropic.claude
 * 1.261009.20 `nl7.b` and 1.261013.20 `wm7.a`, read 2026-10-15; every number is in
 * claude-working-footer-spec.ts). It is the transcript list's last row (MobileNativeChatView's
 * list header), as the app's "thinking_spark" item is, so it scrolls with the messages; pinned
 * above the composer it was drawn over them once the list scrolled (2026-10-15).
 *
 *   3 running tasks                         turn over, tasks still running: the count alone,
 *                                           link blue, no mark (`wm7.a`, 1.261013.20)
 *   [mark] Cooking... · 3 running tasks     working: the app's working mark, a verb that changes
 *                                           every few seconds, the count
 *   [mark] Cooking...                       working, nothing running in the background
 *   [mark] 15s · 2 running tasks · still thinking…
 *                                           working, with the stats Anthropic's events give
 *                                           (claude-working-footer-stats.ts): elapsed time (and
 *                                           thinking tokens) muted, the count link blue, the
 *                                           status phrase muted. With no stats, the verb.
 *                                           After thinking: "· thought for 8s" for 2 s.
 *   [mark] Connecting... · 2 running tasks
 *                                           working with the connection dialling or lost: the
 *                                           notice in place of verb and stats, in the clay (au8
 *                                           case 0, nl7.java:232-235); not a second row.
 *   [mark] Running ls  12s ›                the live tool row (claude-live-tool-row.ts), behind
 *                                           CLAUDE_LIVE_TOOL_ROW_ENABLED (off): the running
 *                                           tool's label, the turn's clock from 2 s, a chevron
 *                                           that opens its details; no count meanwhile
 *   Connection lost · 2 running tasks       a matched tab whose Anthropic stream is lost between
 *                                           turns: muted, no mark (native-chat-connection-notice.ts
 *                                           `quiet`; the chat's rows come from that stream).
 *
 * It used to read "Working · 3 running tasks" beside a breathing starburst (2026-09-24 to
 * 2026-10-14); the user's screenshot of the Claude app showed neither, and asked for the app's own
 * spinner and its count. The count opens the Background tasks sheet, as in the app. Nothing is
 * drawn when the agent is idle with nothing running.
 *
 * A screen reader hears "Working" once, in a live region, and the count as the button it is: the
 * verb is for the eye, because it changes every few seconds and would be read out each time.
 *
 * `spinner` (the agent's own spinner line) is no longer read: the app's verbs are its own.
 */
export function MobileNativeChatStatusLine({
  working,
  markKind = 'think',
  toolRow = null
}: {
  /** Whether this line should say the agent is working. False on the structured lane, whose
   *  per-turn row already says it. */
  working: boolean
  /** Not read; kept so the callers that still pass it keep compiling. */
  spinner?: ClaudeSpinner | null
  /** Which working mark the turn draws (claude-working-mark-kind.ts). */
  markKind?: WorkingMarkKind
  /** The live tool row, or null for the verb and stats (claude-live-tool-row.ts). Its presence
   *  makes the line a working one, as the app's `ToolGroupMark` does (y07.java:947). */
  toolRow?: ClaudeLiveToolRowView | null
}) {
  const { scheme, fonts, type } = useTheme()
  const { runningCount, openSheet } = useNativeChatTasks()
  const verb = useClaudeWorkingVerb(working)
  const live: ClaudeFooterLiveInput | null = useClaudeChatLive()?.footer ?? null
  const footerStats = useClaudeFooterStats(working ? live : null)
  const notice = useNativeChatConnectionNotice()
  // A matched Claude tab's notice is busy on the turn Anthropic last saw open, whatever the relay
  // says (native-chat-connection-notice.ts), so it draws the line by itself.
  const busy = working || toolRow !== null || (notice?.anthropic === true && notice.quiet !== true)
  // A stream lost between turns: its words, muted, with no working mark (nothing is running).
  const quiet = !busy && notice?.quiet === true ? notice.text : null
  if (!busy && quiet === null && runningCount <= 0) {
    return null
  }
  // au8.java:73-91: a connection message stands in for the stats and the verb alike.
  const message = busy ? notice?.text ?? null : null
  const stats = working && message === null ? footerStats : null
  // su8.java:7019-7027: a connection message means no `Working` header, so no tool row.
  const tool = message === null ? toolRow : null
  const palette = claudeStatusFooterPalette(scheme)
  const text = { fontFamily: fonts.medium, fontSize: type.body.size, lineHeight: type.body.lineHeight }
  const count = formatRunningTaskCount(runningCount)
  const countText = <Text style={[text, { color: palette.link }]}>{count}</Text>
  const countButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count}. Open background tasks`}
      // On release, unlike the composer's + and ring: this is where the user swipes with the
      // keyboard up (the dock is box-none for it, device 2026-09-20), and a swipe that starts on
      // the label must not open the sheet.
      onPress={openSheet}
      hitSlop={10}
      style={{ minWidth: CLAUDE_FOOTER_IDLE_MIN_WIDTH, justifyContent: 'center' }}
    >
      {countText}
    </Pressable>
  )
  if (tool !== null) {
    return <LiveToolRow tool={tool} markKind={markKind} />
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        paddingHorizontal: CLAUDE_FOOTER_PADDING_HORIZONTAL,
        paddingVertical: CLAUDE_FOOTER_PADDING_VERTICAL
      }}
      accessibilityLiveRegion="polite"
      testID="native-chat-status-line"
    >
      {busy ? (
        <>
          <View
            accessible
            accessibilityLabel={message ?? 'Working'}
            style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
          >
            <ClaudeWorkingMark color={palette.clay} kind={markKind} />
            <View style={{ width: CLAUDE_FOOTER_MARK_GAP }} />
            {stats ? (
              // The figures roll as the app's do (`z530.a`): each digit in a fixed slot.
              // "15s · 1,234 tokens": each figure rolls on its own, with the square dot between them.
              <View testID="native-chat-status-stats" accessible accessibilityLabel={stats.stats} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                {stats.stats.split(CLAUDE_FOOTER_SEPARATOR).map((part, index) => (
                  <View key={index} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                    {index > 0 ? <ClaudeFooterSeparator color={palette.body} fontSize={text.fontSize} /> : null}
                    <ClaudeRollingText text={part} style={[text, { color: palette.body }]} />
                  </View>
                ))}
              </View>
            ) : (
              // The offline sentence is the app's footer text, drawn whole (zr8.java:1097-1099).
              <Text style={[text, { color: palette.clay, flexShrink: 1 }]} numberOfLines={notice?.kind === 'offline' && message !== null ? undefined : 1}>
                {message ?? `${verb}...`}
              </Text>
            )}
          </View>
          {runningCount > 0 ? (
            <>
              {/* The separator takes the line's text colour: muted beside stats, clay beside a verb (nl7.java:257-293), drawn square as the app's font draws it (ClaudeFooterSeparator). */}
              <ClaudeFooterSeparator color={stats ? palette.body : palette.clay} fontSize={text.fontSize} />
              {countButton}
            </>
          ) : null}
          {stats?.status ? (
            <>
              <ClaudeFooterSeparator color={palette.body} fontSize={text.fontSize} />
              <Text testID="native-chat-status-phrase" style={[text, { color: palette.body, flexShrink: 1 }]} numberOfLines={1}>
                {stats.status}
              </Text>
            </>
          ) : null}
        </>
      ) : quiet !== null ? (
        <>
          <Text accessible accessibilityLabel={quiet} style={[text, { color: palette.body, flexShrink: 1 }]} numberOfLines={1}>
            {quiet}
          </Text>
          {runningCount > 0 ? (
            <>
              <ClaudeFooterSeparator color={palette.body} fontSize={text.fontSize} />
              {countButton}
            </>
          ) : null}
        </>
      ) : (
        countButton
      )}
    </View>
  )
}

/**
 * The live tool row (`wm7.c`'s `r0x` branch, wm7.java:241-275, inside `wm7.a`'s row): the mark, 8 dp,
 * the label (one line, shrinking, never pushing the rest off), the clock after 8 dp, the chevron
 * after 4 dp. The whole line is the button, its 16 dp above and below included, clipped to 12 dp
 * corners for the press highlight (wm7.java:80). No running-tasks count is drawn (y07.java:968).
 */
function LiveToolRow({ tool, markKind }: { tool: ClaudeLiveToolRowView; markKind: WorkingMarkKind }) {
  const { scheme, fonts, type } = useTheme()
  const palette = claudeStatusFooterPalette(scheme)
  const text = { fontFamily: fonts.medium, fontSize: type.body.size, lineHeight: type.body.lineHeight }
  const spoken = tool.clock === null ? tool.label : `${tool.label}, ${tool.clock}`
  const content = (
    <>
      <ClaudeWorkingMark color={palette.clay} kind={markKind} />
      <View style={{ width: CLAUDE_FOOTER_MARK_GAP }} />
      {/* A path keeps its file name's end: the cut goes in the middle (TextOverflow 5). */}
      <View style={{ flexShrink: 1 }}>
        <ShimmerText
          testID="native-chat-tool-row-label"
          text={tool.label}
          active={tool.loading}
          color={palette.toolLabel}
          style={text}
          numberOfLines={1}
          ellipsizeMode={tool.middleEllipsis ? 'middle' : 'tail'}
        />
      </View>
      {tool.clock !== null ? (
        <>
          <View style={{ width: CLAUDE_TOOL_ROW_CLOCK_GAP }} />
          <ClaudeRollingText testID="native-chat-tool-row-clock" text={tool.clock} style={[text, { color: palette.toolClock }]} />
        </>
      ) : null}
      {tool.onPress !== null ? (
        <>
          <View style={{ width: CLAUDE_TOOL_ROW_CHEVRON_GAP }} />
          <ChevronRight testID="native-chat-tool-row-chevron" size={CLAUDE_TOOL_ROW_CHEVRON_SIZE} color={palette.body} strokeWidth={2} />
        </>
      ) : null}
    </>
  )
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: CLAUDE_FOOTER_PADDING_VERTICAL
  }
  return (
    <View
      style={{ paddingHorizontal: CLAUDE_FOOTER_PADDING_HORIZONTAL }}
      accessibilityLiveRegion="polite"
      testID="native-chat-status-line"
    >
      {tool.onPress !== null ? (
        <Pressable
          testID="native-chat-tool-row"
          accessibilityRole="button"
          accessibilityLabel={spoken}
          // `generic_show_details`, the app's click label for the row.
          accessibilityHint="Show details"
          onPress={tool.onPress}
          style={({ pressed }) => [
            row,
            { borderRadius: CLAUDE_TOOL_ROW_RADIUS, overflow: 'hidden' as const },
            pressed ? { opacity: 0.6 } : null
          ]}
        >
          {content}
        </Pressable>
      ) : (
        <View testID="native-chat-tool-row" accessible accessibilityLabel={spoken} style={row}>
          {content}
        </View>
      )}
    </View>
  )
}
