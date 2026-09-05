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
  type ProviderRateLimits,
  type UsageWindowKey
} from '../components/account-usage-state'
import { UsageMeter } from '../components/UsageMeter'
import { usageWindowTitle } from '../components/usage-window-summary'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'

// One provider on the Usage screen, laid out like the Claude app's Usage page:
// a "Current session" card, a "Weekly limits" label, one card per weekly
// window, then the managed accounts as a radio list with their own compact
// meters.

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
  const windows = getVisibleUsageWindows(activeLimits)
  const session = windows.includes('session')
  const weekly = windows.filter((key) => key !== 'session')
  const updated = formatUsageUpdatedLabel(activeLimits, now)
  const hasAccounts = accounts.length > 0

  const meter = (key: UsageWindowKey, title?: string) => {
    const bar = getUsageBarState(activeLimits, key)
    return (
      <UsageMeter
        title={title ?? usageWindowTitle(key, true)}
        usedPercent={bar.usedPercent}
        unavailable={bar.unavailable}
        loading={bar.loading}
        subtitle={
          getWindowResetLabel(activeLimits, key, now) ??
          (key === 'session' && bar.usedPercent === 0 ? 'Starts when a message is sent' : null)
        }
      />
    )
  }

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.xs,
          paddingTop: space.sm
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: colors.bgRaised,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {provider === 'claude' ? (
            <ClaudeIcon size={18} />
          ) : (
            <OpenAIIcon size={18} color={colors.text} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="heading" weight="semibold">
            {PROVIDER_NAME[provider]}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {activeEmail ?? 'Signed in on the desktop'}
            {updated ? ` · ${updated}` : ''}
          </Txt>
        </View>
        {activeLimits?.status === 'fetching' ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : null}
      </View>

      {windows.length === 0 ? (
        <Surface rounded="lg" padded>
          <Txt variant="body" tone="muted">
            No usage reported yet.
          </Txt>
        </Surface>
      ) : null}

      {session ? (
        <Surface rounded="lg" style={{ padding: space.lg }}>
          {meter('session')}
        </Surface>
      ) : null}

      {weekly.length > 0 ? (
        <>
          {session ? (
            <Txt variant="body" tone="secondary" style={{ paddingHorizontal: space.xs }}>
              Weekly limits
            </Txt>
          ) : null}
          <Surface rounded="lg" style={{ overflow: 'hidden' }}>
            {weekly.map((key, index) => (
              <View
                key={key}
                style={{
                  padding: space.lg,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border
                }}
              >
                {meter(key, weekly.length === 1 && !session ? 'Weekly limit' : undefined)}
              </View>
            ))}
          </Surface>
        </>
      ) : null}

      {activeLimits?.error ? (
        <Txt
          variant="caption"
          tone="danger"
          numberOfLines={2}
          style={{ paddingHorizontal: space.xs }}
        >
          {activeLimits.error}
        </Txt>
      ) : null}

      {hasAccounts ? (
        <>
          <Txt variant="body" tone="secondary" style={{ paddingHorizontal: space.xs }}>
            Accounts
          </Txt>
          <Surface rounded="lg" style={{ overflow: 'hidden' }}>
            <AccountRow
              first
              title="Desktop login"
              subtitle="Use the agent's own sign-in"
              selected={activeAccountId === null}
              busy={busyAccountId === `${provider}:default`}
              disabled={disabled || activeAccountId === null}
              onPress={() => onSelect(null)}
            />
            {accounts.map((account) => {
              const selected = activeAccountId === account.id
              const keys = selected
                ? []
                : getVisibleUsageWindows(account.limits, account.isFetching)
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
            {footer}
          </Surface>
        </>
      ) : (
        footer
      )}
    </View>
  )
}

function AccountRow({
  first = false,
  title,
  subtitle,
  selected,
  busy,
  disabled,
  onPress,
  children
}: {
  first?: boolean
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
        borderTopWidth: first ? 0 : 1,
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
