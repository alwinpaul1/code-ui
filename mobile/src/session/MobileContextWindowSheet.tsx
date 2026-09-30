import { useState } from 'react'
import Animated from 'react-native-reanimated'
import { useUsageProgress } from '../components/use-usage-progress'
import { View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/** "5-hour", "Weekly", "Monthly" — named from the window the agent reported
 *  rather than assumed, because the buckets differ by plan. */
export function formatLimitWindowName(minutes: number | null): string {
  if (minutes === null || minutes <= 0) {
    return 'Usage'
  }
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080
    return weeks === 1 ? 'Weekly' : `${weeks}-week`
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? 'Daily' : `${days}-day`
  }
  const hours = Math.round(minutes / 60)
  return hours <= 1 ? 'Hourly' : `${hours}-hour`
}

/** "resets in 3h 20m", or nothing when the agent did not say. The time left
 *  rounds up to whole minutes, as the Accounts countdown does
 *  (`formatResetCountdown`), so 30 s left reads "resets in 1m" and 59 m 30 s
 *  "resets in 1h 0m": flooring read any last minute as "resets in 0m", as if
 *  the limit had already reset (review, 2026-09-30). */
export function formatLimitReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) {
    return null
  }
  const seconds = resetsAt - Math.floor(now / 1000)
  if (seconds <= 0) {
    return 'resetting now'
  }
  const totalMinutes = Math.ceil(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 24) {
    return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
  }
  return hours > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${minutes}m`
}

export function formatContextWindowFigure(context: TerminalHudContextWindow): string {
  const pct = `${Math.round(context.usedPercent)}%`
  return context.usedLabel && context.windowLabel
    ? `${context.usedLabel} / ${context.windowLabel} (${pct})`
    : pct
}

/** "Context window  537.2k / 1M (54%)" with a bar, as Claude Code shows it
 *  when the ring is tapped. The figure comes from the desktop's status line,
 *  so it refreshes with the terminal, a few seconds behind the agent. */
export function MobileContextWindowSheet({
  visible,
  context,
  onClose
}: {
  visible: boolean
  context: TerminalHudContextWindow | null
  onClose: () => void
}) {
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss dismissKeyboardOnOpen>
      <ContextWindowSheetBody context={context} />
    </BottomDrawer>
  )
}

/** The sheet's content, which the drawer mounts when it opens and unmounts
 *  once it has closed. */
function ContextWindowSheetBody({ context }: { context: TerminalHudContextWindow | null }) {
  const { space } = useTheme()
  // Read once per opening, when the drawer mounts this body: a reset countdown
  // does not need to tick while the sheet is up, and calling the clock during
  // render is neither pure nor stable. It lived on the sheet itself, which the
  // composer mounts with the chat and only flips `visible` on, so every reset
  // was counted from when the chat opened: "resets in 3h 0m" with 1h left,
  // and never "resetting now" (review, 2026-09-30).
  const [now] = useState(() => Date.now())
  const limits = context?.limits
  const planType = context?.planType
  const pct = context ? Math.max(0, Math.min(100, context.usedPercent)) : 0
  return (
    <Surface rounded="lg" style={{ padding: space.md + 2, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Txt variant="body" weight="medium" style={{ flex: 1 }}>
          Context window
        </Txt>
        <Txt variant="body" tone="secondary">
          {context ? formatContextWindowFigure(context) : 'Not reported'}
        </Txt>
      </View>
      <UsageBar percent={pct} height={8} />
      {limits?.length ? (
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          {planType ? (
            <Txt variant="caption" tone="muted">
              Plan: {planType}
            </Txt>
          ) : null}
          {limits.map((window, index) => {
            const used = Math.max(0, Math.min(100, window.usedPercent))
            const reset = formatLimitReset(window.resetsAt, now)
            const name = window.name ?? formatLimitWindowName(window.windowMinutes)
            // Not the window length alone: Weekly and Fable are both 10,080
            // minutes, and two rows with one key can be swapped or dropped on
            // the next update (review, 2026-09-30). The rows keep a fixed
            // order (hudLimitsFromRateLimits), so the position is stable.
            return (
              <View key={`${index}:${name}`} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="caption" style={{ flex: 1 }}>
                    {name}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {Math.round(used)}%{reset ? ` · ${reset}` : ''}
                  </Txt>
                </View>
                <UsageBar percent={used} height={6} />
              </View>
            )
          })}
        </View>
      ) : null}
    </Surface>
  )
}

/** A track with an eased fill whose colour fades along the usage scale. */
function UsageBar({ percent, height }: { percent: number; height: number }) {
  const { colors } = useTheme()
  const { barStyle } = useUsageProgress(percent)
  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: colors.bgSunken,
        overflow: 'hidden'
      }}
    >
      <Animated.View style={[{ height: '100%', borderRadius: height / 2 }, barStyle]} />
    </View>
  )
}
