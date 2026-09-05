import { View } from 'react-native'
import type { HomeStatsSummary } from '../stats/home-stats-total'
import { useTheme } from '../theme/theme-context'
import { SectionLabel } from '../ui/SectionLabel'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  return totalHours > 0 ? `${totalHours}h ${minutes}m` : `${totalMinutes}m`
}

export function greetingForHour(hour: number): string {
  if (hour < 5) {
    return 'Still up?'
  }
  if (hour < 12) {
    return 'Good morning'
  }
  if (hour < 18) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

function Stat({ value, label }: { value: string; label: string }) {
  const { space } = useTheme()
  return (
    <Surface style={{ flex: 1, paddingVertical: space.sm + 2, paddingHorizontal: space.md }}>
      <Txt variant="heading" weight="semibold" numberOfLines={1}>
        {value}
      </Txt>
      <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </Surface>
  )
}

export function MobileHomeListHeader({ stats }: { stats: HomeStatsSummary | null }) {
  const { space } = useTheme()
  return (
    <View>
      <View style={{ paddingTop: space.md, paddingBottom: space.lg }}>
        <Txt variant="display" weight="semibold">
          {greetingForHour(new Date().getHours())}
        </Txt>
        <Txt variant="body" tone="secondary" style={{ marginTop: space.xs }}>
          Your desktops and the agents running on them.
        </Txt>
      </View>
      {stats ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Stat value={stats.totalAgentsSpawned.toLocaleString()} label="Agents spawned" />
          <Stat value={formatDuration(stats.totalAgentTimeMs)} label="Agent time" />
          <Stat value={stats.totalPRsCreated.toLocaleString()} label="PRs created" />
        </View>
      ) : null}
      <SectionLabel style={{ marginTop: stats ? space.xl : space.sm }}>Desktops</SectionLabel>
    </View>
  )
}
