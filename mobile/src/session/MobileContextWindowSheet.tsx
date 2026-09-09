import { useState } from 'react'
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

/** "resets in 3h 20m", or nothing when the agent did not say. */
export function formatLimitReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) {
    return null
  }
  const seconds = resetsAt - Math.floor(now / 1000)
  if (seconds <= 0) {
    return 'resetting now'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `resets in ${days}d ${hours % 24}h`
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
  const { colors, space } = useTheme()
  // Read once when the sheet mounts: a reset countdown does not need to tick,
  // and calling the clock during render is neither pure nor stable.
  const [now] = useState(() => Date.now())
  const limits = context?.limits
  const planType = context?.planType
  const pct = context ? Math.max(0, Math.min(100, context.usedPercent)) : 0
  const color = pct >= 90 ? colors.danger : pct >= 70 ? colors.warning : colors.info
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss>
      <Surface rounded="lg" style={{ padding: space.md + 2, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="body" weight="medium" style={{ flex: 1 }}>
            Context window
          </Txt>
          <Txt variant="body" tone="secondary">
            {context ? formatContextWindowFigure(context) : 'Not reported'}
          </Txt>
        </View>
        <View
          style={{ height: 8, borderRadius: 4, backgroundColor: colors.bgSunken, overflow: 'hidden' }}
        >
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
        </View>
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
              const bar =
                used >= 90 ? colors.danger : used >= 70 ? colors.warning : colors.info
              return (
                <View key={`${window.windowMinutes ?? index}`} style={{ gap: space.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Txt variant="caption" style={{ flex: 1 }}>
                      {window.name ?? formatLimitWindowName(window.windowMinutes)}
                    </Txt>
                    <Txt variant="caption" tone="secondary">
                      {Math.round(used)}%{reset ? ` · ${reset}` : ''}
                    </Txt>
                  </View>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.bgSunken,
                      overflow: 'hidden'
                    }}
                  >
                    <View
                      style={{
                        width: `${used}%`,
                        height: '100%',
                        backgroundColor: bar,
                        borderRadius: 3
                      }}
                    />
                  </View>
                </View>
              )
            })}
          </View>
        ) : null}
      </Surface>
    </BottomDrawer>
  )
}
