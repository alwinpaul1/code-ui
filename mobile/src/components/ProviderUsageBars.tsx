import { View } from 'react-native'
import {
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
  const showFable = hasFableWindow(limits)
  const labelWidth = showFable ? USAGE_LABEL_WIDTH_WIDE : USAGE_LABEL_WIDTH
  const session = getUsageBarState(limits, 'session', isFetching)
  const weekly = getUsageBarState(limits, 'weekly', isFetching)
  const fable = getUsageBarState(limits, 'fableWeekly', isFetching)
  const reset = (key: 'session' | 'weekly' | 'fableWeekly') =>
    now === undefined ? null : getWindowResetLabel(limits, key, now)
  if (layout === 'stacked' || layout === 'columns') {
    const compact = layout === 'columns'
    const meters = [
      <UsageMeter
        key="session"
        title={compact ? 'Session' : 'Session · 5h'}
        usedPercent={session.usedPercent}
        unavailable={session.unavailable}
        loading={session.loading}
        resetText={reset('session')}
        compact={compact}
      />,
      <UsageMeter
        key="weekly"
        title={compact ? 'Weekly' : 'Weekly · 7d'}
        usedPercent={weekly.usedPercent}
        unavailable={weekly.unavailable}
        loading={weekly.loading}
        resetText={reset('weekly')}
        compact={compact}
      />,
      ...(showFable
        ? [
            <UsageMeter
              key="fable"
              title={compact ? 'Fable' : 'Fable · 7d'}
              usedPercent={fable.usedPercent}
              unavailable={fable.unavailable}
              loading={fable.loading}
              resetText={reset('fableWeekly')}
              compact={compact}
            />
          ]
        : [])
    ]
    if (!compact) {
      return <>{meters}</>
    }
    return (
      <>
        {meters.map((meter) => (
          <View key={meter.key} style={{ flex: 1, minWidth: 0 }}>
            {meter}
          </View>
        ))}
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
