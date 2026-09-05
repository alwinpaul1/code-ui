import { View } from 'react-native'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  getActiveProviderRateLimits,
  getUsageBarState,
  hasActiveProviderUsage,
  type AccountsSnapshot,
  type ProviderKey
} from '../components/AccountUsage'
import { getVisibleUsageWindows, getWindowResetLabel } from '../components/account-usage-state'
import { useNow } from '../hooks/use-now'
import { UsageMeter } from '../components/UsageMeter'
import { usageWindowTitle } from '../components/usage-window-summary'
import { useTheme } from '../theme/theme-context'
import type { HostProfile } from '../transport/types'
import { PressScale } from '../ui/PressScale'
import { SectionLabel } from '../ui/SectionLabel'
import { Txt } from '../ui/Txt'

// Home usage card: one block per provider — tile, name, the signed-in account
// — with the per-window meters underneath, one column per window the plan
// reports. Tapping opens the Usage screen.

const PROVIDER_NAME: Record<ProviderKey, string> = { claude: 'Claude', codex: 'Codex' }

export function MobileHomeAccountUsageCards(props: {
  items: { host: HostProfile; snapshot: AccountsSnapshot }[]
  onOpen: (hostId: string) => void
}) {
  const { colors, radius, space } = useTheme()
  // Why: reset lines need a clock; a minute tick is plenty for "Resets in 3 hr 29 min".
  const now = useNow(60_000, props.items.length > 0)
  if (props.items.length === 0) {
    return null
  }
  return (
    <>
      <SectionLabel>Account usage</SectionLabel>
      {props.items.map(({ host, snapshot }) => (
        <PressScale
          key={host.id}
          accessibilityRole="button"
          pressedScale={0.985}
          style={{
            backgroundColor: colors.bgPanel,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.xl,
            marginBottom: space.sm
          }}
          onPress={() => props.onOpen(host.id)}
        >
          {props.items.length > 1 ? (
            <Txt
              variant="caption"
              weight="medium"
              tone="muted"
              numberOfLines={1}
              style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}
            >
              {host.name}
            </Txt>
          ) : null}
          {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
            const state = provider === 'claude' ? snapshot.claude : snapshot.codex
            const active =
              state.accounts.find((account) => account.id === state.activeAccountId) ?? null
            const limits = getActiveProviderRateLimits(snapshot, provider)
            if (state.accounts.length === 0 && !hasActiveProviderUsage(limits)) {
              return null
            }
            const windows = getVisibleUsageWindows(limits)
            const subtitle = active?.email ?? null
            return (
              <View key={provider} style={{ gap: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.md,
                      backgroundColor: colors.bgRaised,
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {provider === 'claude' ? (
                      <ClaudeIcon size={20} />
                    ) : (
                      <OpenAIIcon size={20} color={colors.text} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Txt variant="heading" weight="semibold" numberOfLines={1}>
                      {PROVIDER_NAME[provider]}
                    </Txt>
                    {subtitle ? (
                      <Txt variant="caption" tone="muted" numberOfLines={1}>
                        {subtitle}
                      </Txt>
                    ) : null}
                  </View>
                </View>
                {windows.length > 0 ? (
                  <View style={{ gap: space.md }}>
                    {windows.map((key) => {
                      const bar = getUsageBarState(limits, key)
                      return (
                        <UsageMeter
                          key={key}
                          title={
                            key === 'weekly' && !windows.includes('session')
                              ? 'Weekly limit'
                              : usageWindowTitle(key, true)
                          }
                          usedPercent={bar.usedPercent}
                          unavailable={bar.unavailable}
                          loading={bar.loading}
                          subtitle={getWindowResetLabel(limits, key, now)}
                          dense
                        />
                      )
                    })}
                  </View>
                ) : null}
              </View>
            )
          })}
        </PressScale>
      ))}
    </>
  )
}
