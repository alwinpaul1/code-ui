import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  formatUsageUpdatedLabel,
  getUsageBarState,
  getWindowResetLabel,
  hasFableWindow,
  type ProviderRateLimits
} from './account-usage-state'
import { UsageBar, USAGE_LABEL_WIDTH, USAGE_LABEL_WIDTH_WIDE } from './AccountUsage'
import { UsageMeter } from './UsageMeter'

/**
 * The 5h and 7d bars for one provider, plus a "Fable" bar when the host
 * reports the Fable model's own weekly window (Orca parses it from `/usage`).
 * Reset labels render only when `now` is given; the home card omits them.
 *
 * `stacked` gives each window its own full-width block for the Accounts page;
 * `columns` puts the same blocks side by side for the home card, one column
 * per window; `inline` is the original single-line bar.
 */
export function ProviderUsageBars({
  limits,
  isFetching,
  now,
  layout = 'inline'
}: {
  limits: ProviderRateLimits | null
  isFetching?: boolean
  now?: number
  layout?: 'inline' | 'stacked' | 'columns'
}) {
  const { space } = useTheme()
  const showFable = hasFableWindow(limits)
  const labelWidth = showFable ? USAGE_LABEL_WIDTH_WIDE : USAGE_LABEL_WIDTH
  const session = getUsageBarState(limits, 'session', isFetching)
  const weekly = getUsageBarState(limits, 'weekly', isFetching)
  const fable = getUsageBarState(limits, 'fableWeekly', isFetching)
  const reset = (key: 'session' | 'weekly' | 'fableWeekly') =>
    now === undefined ? null : getWindowResetLabel(limits, key, now)
  if (layout === 'columns') {
    const columns = [
      { key: 'session', title: 'Session', state: session },
      { key: 'weekly', title: 'Weekly', state: weekly },
      ...(showFable ? [{ key: 'fable', title: 'Fable', state: fable }] : [])
    ]
    return (
      <>
        {columns.map((column) => (
          <View key={column.key} style={{ flex: 1, minWidth: 0 }}>
            <UsageMeter
              title={column.title}
              usedPercent={column.state.usedPercent}
              unavailable={column.state.unavailable}
              loading={column.state.loading}
              compact
            />
          </View>
        ))}
      </>
    )
  }
  if (layout === 'stacked') {
    // Mirrors Claude's Usage page: "Current session", then a "Weekly limits"
    // group holding the all-models window and any model-specific one (Fable).
    const sessionSubtitle =
      reset('session') ??
      (session.usedPercent === 0 ? 'Starts when a message is sent' : null)
    const updated = now === undefined ? null : formatUsageUpdatedLabel(limits, now)
    return (
      <>
        <UsageMeter
          title="Current session"
          usedPercent={session.usedPercent}
          unavailable={session.unavailable}
          loading={session.loading}
          subtitle={sessionSubtitle}
        />
        <View style={{ gap: space.sm + 2 }}>
          <Txt variant="caption" weight="semibold" tone="secondary">
            Weekly limits
          </Txt>
          <UsageMeter
            title="All models"
            usedPercent={weekly.usedPercent}
            unavailable={weekly.unavailable}
            loading={weekly.loading}
            subtitle={reset('weekly')}
          />
          {showFable ? (
            <UsageMeter
              title="Fable"
              usedPercent={fable.usedPercent}
              unavailable={fable.unavailable}
              loading={fable.loading}
              subtitle={reset('fableWeekly')}
            />
          ) : null}
        </View>
        {updated ? (
          <Txt variant="caption" tone="muted">
            {updated}
          </Txt>
        ) : null}
      </>
    )
  }
  return (
    <>
      <UsageBar
        label="5h"
        labelWidth={labelWidth}
        usedPercent={session.usedPercent}
        unavailable={session.unavailable}
        loading={session.loading}
        resetText={reset('session')}
      />
      <UsageBar
        label="7d"
        labelWidth={labelWidth}
        usedPercent={weekly.usedPercent}
        unavailable={weekly.unavailable}
        loading={weekly.loading}
        resetText={reset('weekly')}
      />
      {showFable ? (
        <UsageBar
          label="Fable"
          labelWidth={labelWidth}
          usedPercent={fable.usedPercent}
          unavailable={fable.unavailable}
          loading={fable.loading}
          resetText={reset('fableWeekly')}
        />
      ) : null}
    </>
  )
}
