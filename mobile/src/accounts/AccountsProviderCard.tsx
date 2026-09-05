import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Check } from 'lucide-react-native'

import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  formatUsageUpdatedLabel,
  getUsageBarState,
  getVisibleUsageWindows,
  getWindowResetLabel,
  type ProviderKey,
  type ProviderRateLimits
} from '../components/account-usage-state'
import { UsageMeter } from '../components/UsageMeter'
import { UsageRing } from '../components/UsageRing'
import { getUsageHeadline, usageWindowTitle } from '../components/usage-window-summary'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'

// One provider on the Usage screen: identity row, a ring leading with the
// window closest to its limit (Revolut / Vivid "used of limit"), the per-window
// meters, then the managed accounts as a radio list with their own usage
// (Rocket Money's "usage by account").

const PROVIDER_NAME: Record<ProviderKey, string> = { claude: 'Claude', codex: 'Codex' }

export type AccountsProviderAccountRow = {
  id: string
  email: string
  limits: ProviderRateLimits | null
  isFetching: boolean
}

export function AccountsProviderCard({
  provider,
  activeLimits,
  activeEmail,
  activeAccountId,
  accounts,
  now,
  busyAccountId,
  disabled,
  onSelect,
  footer
}: {
  provider: ProviderKey
  activeLimits: ProviderRateLimits | null
  activeEmail: string | null
  activeAccountId: string | null
  accounts: AccountsProviderAccountRow[]
  now: number
  busyAccountId: string | null
  disabled: boolean
  onSelect: (accountId: string | null) => void
  footer?: ReactNode
}) {
  const { colors, radius, space } = useTheme()
  const headline = getUsageHeadline(activeLimits, now)
  const windows = getVisibleUsageWindows(activeLimits)
  const updated = formatUsageUpdatedLabel(activeLimits, now)
  const hasAccounts = accounts.length > 0

  return (
    <Surface rounded="lg" style={{ overflow: 'hidden' }}>
      <View style={{ padding: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: colors.bgRaised,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {provider === 'claude' ? (
              <ClaudeIcon size={22} />
            ) : (
              <OpenAIIcon size={22} color={colors.text} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Txt variant="heading" weight="semibold">
              {PROVIDER_NAME[provider]}
            </Txt>
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {activeEmail ?? 'Signed in on the desktop'}
            </Txt>
          </View>
          {activeLimits?.status === 'fetching' ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : null}
        </View>

        {headline ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <UsageRing
              size={92}
              strokeWidth={9}
              usedPercent={headline.usedPercent}
              unavailable={headline.unavailable}
              loading={headline.loading}
              caption="used"
            />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="caption" weight="medium" tone="muted">
                {usageWindowTitle(headline.key, true)}
              </Txt>
              <Txt variant="body" weight="medium">
                {headline.resetLabel ?? 'Starts when a message is sent'}
              </Txt>
              {updated ? (
                <Txt variant="caption" tone="muted">
                  {updated}
                </Txt>
              ) : null}
            </View>
          </View>
        ) : null}

        {windows.length > 0 ? (
          <View style={{ gap: space.md }}>
            {windows.map((key) => {
              const bar = getUsageBarState(activeLimits, key)
              return (
                <UsageMeter
                  key={key}
                  title={usageWindowTitle(key, true)}
                  usedPercent={bar.usedPercent}
                  unavailable={bar.unavailable}
                  loading={bar.loading}
                  subtitle={getWindowResetLabel(activeLimits, key, now)}
                />
              )
            })}
          </View>
        ) : (
          <Txt variant="body" tone="muted">
            No usage reported yet.
          </Txt>
        )}
        {activeLimits?.error ? (
          <Txt variant="caption" tone="danger" numberOfLines={2}>
            {activeLimits.error}
          </Txt>
        ) : null}
      </View>

      {hasAccounts ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
          <Txt
            variant="caption"
            weight="semibold"
            tone="muted"
            style={{
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              textTransform: 'uppercase',
              letterSpacing: 0.6
            }}
          >
            Accounts
          </Txt>
          <AccountRow
            title="Desktop login"
            subtitle="Use the agent's own sign-in"
            selected={activeAccountId === null}
            busy={busyAccountId === `${provider}:default`}
            disabled={disabled || activeAccountId === null}
            onPress={() => onSelect(null)}
          />
          {accounts.map((account) => {
            const selected = activeAccountId === account.id
            const keys = selected ? [] : getVisibleUsageWindows(account.limits, account.isFetching)
            return (
              <AccountRow
                key={account.id}
                title={account.email}
                selected={selected}
                busy={busyAccountId === account.id}
                disabled={disabled || selected}
                onPress={() => onSelect(account.id)}
              >
                {keys.length > 0 ? (
                  <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
                    {keys.map((key) => {
                      const bar = getUsageBarState(account.limits, key, account.isFetching)
                      return (
                        <View key={key} style={{ flex: 1, minWidth: 0 }}>
                          <UsageMeter
                            title={usageWindowTitle(key)}
                            usedPercent={bar.usedPercent}
                            unavailable={bar.unavailable}
                            loading={bar.loading}
                            compact
                          />
                        </View>
                      )
                    })}
                  </View>
                ) : null}
              </AccountRow>
            )
          })}
        </View>
      ) : null}
      {footer}
    </Surface>
  )
}

function AccountRow({
  title,
  subtitle,
  selected,
  busy,
  disabled,
  onPress,
  children
}: {
  title: string
  subtitle?: string
  selected: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
  children?: ReactNode
}) {
  const { colors, space } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.borderStrong,
          backgroundColor: selected ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : selected ? (
          <Check size={14} color={colors.onAccent} strokeWidth={3} />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body" weight={selected ? 'semibold' : 'medium'} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
        {children}
      </View>
    </Pressable>
  )
}
