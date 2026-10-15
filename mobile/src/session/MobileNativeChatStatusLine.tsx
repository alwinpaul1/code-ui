import { Pressable, Text, View } from 'react-native'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { useTheme } from '../theme/theme-context'
import { ClaudeRollingText } from './ClaudeRollingText'
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
  markKind = 'think'
}: {
  /** Whether this line should say the agent is working. False on the structured lane, whose
   *  per-turn row already says it. */
  working: boolean
  /** Not read; kept so the callers that still pass it keep compiling. */
  spinner?: ClaudeSpinner | null
  /** Which working mark the turn draws (claude-working-mark-kind.ts). */
  markKind?: WorkingMarkKind
}) {
  const { scheme, fonts, type } = useTheme()
  const { runningCount, openSheet } = useNativeChatTasks()
  const verb = useClaudeWorkingVerb(working)
  const live: ClaudeFooterLiveInput | null = useClaudeChatLive()?.footer ?? null
  const footerStats = useClaudeFooterStats(working ? live : null)
  const notice = useNativeChatConnectionNotice()
  // A matched Claude tab's notice is busy on the turn Anthropic last saw open, whatever the relay
  // says (native-chat-connection-notice.ts), so it draws the line by itself.
  const busy = working || notice?.anthropic === true
  if (!busy && runningCount <= 0) {
    return null
  }
  // au8.java:73-91: a connection message stands in for the stats and the verb alike.
  const message = busy ? notice?.text ?? null : null
  const stats = working && message === null ? footerStats : null
  const palette = claudeStatusFooterPalette(scheme)
  const text = { fontFamily: fonts.regular, fontSize: type.body.size, lineHeight: type.body.lineHeight }
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
              <ClaudeRollingText testID="native-chat-status-stats" text={stats.stats} style={[text, { color: palette.body }]} />
            ) : (
              // The offline sentence is the app's footer text, drawn whole (zr8.java:1097-1099).
              <Text style={[text, { color: palette.clay, flexShrink: 1 }]} numberOfLines={notice?.kind === 'offline' && message !== null ? undefined : 1}>
                {message ?? `${verb}...`}
              </Text>
            )}
          </View>
          {runningCount > 0 ? (
            <>
              {/* The separator takes the line's text colour: muted beside stats, clay beside a verb (nl7.java:257-293). */}
              <Text style={[text, { color: stats ? palette.body : palette.clay }]}>{CLAUDE_FOOTER_SEPARATOR}</Text>
              {countButton}
            </>
          ) : null}
          {stats?.status ? (
            <Text testID="native-chat-status-phrase" style={[text, { color: palette.body, flexShrink: 1 }]} numberOfLines={1}>
              {`${CLAUDE_FOOTER_SEPARATOR}${stats.status}`}
            </Text>
          ) : null}
        </>
      ) : (
        countButton
      )}
    </View>
  )
}
