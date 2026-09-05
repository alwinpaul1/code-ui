import { View } from 'react-native'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  getActiveProviderRateLimits,
  hasActiveProviderUsage,
  type AccountsSnapshot,
  type ProviderKey
} from '../components/AccountUsage'
import { ProviderUsageBars } from '../components/ProviderUsageBars'
import { useTheme } from '../theme/theme-context'
import type { HostProfile } from '../transport/types'
import { PressScale } from '../ui/PressScale'
import { SectionLabel } from '../ui/SectionLabel'
import { Txt } from '../ui/Txt'

export function MobileHomeAccountUsageCards(props: {
  items: { host: HostProfile; snapshot: AccountsSnapshot }[]
  onOpen: (hostId: string) => void
}) {
  const { colors, radius, space } = useTheme()
  if (props.items.length === 0) {
    return null
  }
  return (
    <>
      <SectionLabel>Account usage</SectionLabel>
      {props.items.map(({ host, snapshot }) => {
        const claudeActive =
          snapshot.claude.accounts.find(
            (account) => account.id === snapshot.claude.activeAccountId
          ) ?? null
        const codexActive =
          snapshot.codex.accounts.find(
            (account) => account.id === snapshot.codex.activeAccountId
          ) ?? null
        return (
          <PressScale
            key={host.id}
            accessibilityRole="button"
            pressedScale={0.985}
            style={{
              backgroundColor: colors.bgPanel,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.lg,
              paddingHorizontal: space.md,
              paddingVertical: space.md,
              // Why: two providers stacked read as one block at sm; lg gives
              // each its own breathing room without a divider.
              gap: space.lg,
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
              const active = provider === 'claude' ? claudeActive : codexActive
              const accounts =
                provider === 'claude' ? snapshot.claude.accounts : snapshot.codex.accounts
              const limits = getActiveProviderRateLimits(snapshot, provider)
              if (accounts.length === 0 && !hasActiveProviderUsage(limits)) {
                return null
              }
              return (
                <View
                  key={provider}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: radius.sm,
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
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    {active?.email ? (
                      <Txt variant="label" weight="semibold" numberOfLines={1}>
                        {active.email}
                      </Txt>
                    ) : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: space.md,
                        marginTop: active?.email ? 6 : 0
                      }}
                    >
                      <ProviderUsageBars limits={limits} layout="columns" />
                    </View>
                  </View>
                </View>
              )
            })}
          </PressScale>
        )
      })}
    </>
  )
}
