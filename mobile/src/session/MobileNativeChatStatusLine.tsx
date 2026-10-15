import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { useTheme } from '../theme/theme-context'
import { ClaudeSpinnerSprite } from './ClaudeSpinnerSprite'
import {
  CLAUDE_FOOTER_IDLE_MIN_WIDTH,
  CLAUDE_FOOTER_PADDING_VERTICAL,
  CLAUDE_FOOTER_SEPARATOR,
  CLAUDE_SPINNER
} from './claude-working-footer-spec'
import { formatRunningTaskCount } from './mobile-background-task-labels'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import { useNativeChatTasks } from './native-chat-tasks-context'
import { useClaudeWorkingVerb } from './use-claude-working-verb'
import { useClaudeChatLive } from './claude-chat-live'
import { claudeFooterStats, type ClaudeFooterLiveInput } from './claude-working-footer-stats'

/** Now, re-read once a second while `on`: the stats' elapsed time counts up as the app's does. */
function useSecondClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

/**
 * The line above the composer, as the Claude app draws it (com.anthropic.claude 1.261009.20,
 * `nl7.b`, read 2026-10-15; every number is in claude-working-footer-spec.ts):
 *
 *   3 running tasks                         turn over, tasks still running: the count alone,
 *                                           link blue, no star
 *   [spinner] Cooking... · 3 running tasks  working: the Claude spinner, a verb that changes
 *                                           every few seconds, the count
 *   [spinner] Cooking...                    working, nothing running in the background
 *   [spinner] 15s · 2 running tasks · still thinking…
 *                                           working, with the stats Anthropic's events give
 *                                           (claude-working-footer-stats.ts): elapsed time (and
 *                                           thinking tokens) muted, the count link blue, the
 *                                           status phrase muted. With no stats, the verb.
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
  working
}: {
  /** Whether this line should say the agent is working. False on the structured lane, whose
   *  per-turn row already says it. */
  working: boolean
  /** Not read; kept so the callers that still pass it keep compiling. */
  spinner?: ClaudeSpinner | null
}) {
  const { scheme, fonts, type } = useTheme()
  const { runningCount, openSheet } = useNativeChatTasks()
  const verb = useClaudeWorkingVerb(working)
  const live: ClaudeFooterLiveInput | null = useClaudeChatLive()?.footer ?? null
  const now = useSecondClock(working && live !== null)
  if (!working && runningCount <= 0) {
    return null
  }
  const stats = working && live ? claudeFooterStats(live, now) : null
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
        paddingVertical: CLAUDE_FOOTER_PADDING_VERTICAL
      }}
      accessibilityLiveRegion="polite"
      testID="native-chat-status-line"
    >
      {working ? (
        <>
          <View
            accessible
            accessibilityLabel="Working"
            style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
          >
            <ClaudeSpinnerSprite color={palette.clay} animating />
            <View style={{ width: CLAUDE_SPINNER.gapWorking }} />
            {stats ? (
              <Text testID="native-chat-status-stats" style={[text, { color: palette.body }]} numberOfLines={1}>
                {stats.stats}
              </Text>
            ) : (
              <Text style={[text, { color: palette.clay, flexShrink: 1 }]} numberOfLines={1}>
                {`${verb}...`}
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
