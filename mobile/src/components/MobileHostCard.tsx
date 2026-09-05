import { ChevronRight, Monitor, MoreHorizontal } from 'lucide-react-native'
import { View } from 'react-native'
import type { ConnectionVerdict } from '../transport/connection-health'
import { verdictDisplayLabel } from '../transport/connection-health'
import { mobileConnectionPathLabel } from '../transport/mobile-connection-path-label'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import { homeHostWorktreeSummary, type HostWorktreeInfo } from '../worktree/home-worktree-info'
import { StatusDot } from './StatusDot'

export function MobileHostCard(props: {
  host: HostProfile | HostCatalogEntry
  credentialStatus?: HostCatalogEntry['credentialStatus']
  state: ConnectionState
  verdict: ConnectionVerdict
  path: MobileConnectionPath
  // Why: the card owns the fresh/stale/unavailable wording so no caller can re-gate the counts
  // away (STA-3123 shipped that bug once already).
  worktreeInfo?: HostWorktreeInfo
  onPress: () => void
  onLongPress: () => void
  onOpenActions: () => void
}) {
  const { colors, radius, space } = useTheme()
  const credentialUnavailable = props.credentialStatus === 'temporarily-unavailable'
  const credentialMissing = props.credentialStatus === 'missing'
  const connected = props.state === 'connected' && !credentialUnavailable && !credentialMissing
  const isError =
    credentialMissing || ['warning', 'unreachable', 'auth-failed'].includes(props.verdict.kind)
  const statusLabel = credentialMissing
    ? 'Pairing invalid'
    : credentialUnavailable
      ? 'Pairing temporarily unavailable'
      : verdictDisplayLabel(props.verdict)
  const statusVerdict: ConnectionVerdict = credentialMissing
    ? { kind: 'auth-failed', label: statusLabel }
    : credentialUnavailable
      ? { kind: 'warning', label: statusLabel }
      : props.verdict
  const worktreeSummary = homeHostWorktreeSummary(props.worktreeInfo)
  const connectionPathLabel =
    !credentialMissing && !credentialUnavailable && connected
      ? mobileConnectionPathLabel(props.path)
      : null
  const discoveryHint =
    props.verdict.kind === 'unreachable' && !props.host.relay
      ? 'Update the desktop app and sign in to connect from anywhere'
      : null
  const credentialHint = credentialMissing
    ? 'Tap to re-pair with your desktop'
    : credentialUnavailable
      ? 'Unlock your phone, then tap to retry'
      : null
  const accessibilityLabel = [
    `Open ${props.host.name}`,
    statusLabel,
    connectionPathLabel?.replace(' · ', ' via '),
    connected ? worktreeSummary?.replace(' · ', ', ') : null,
    discoveryHint,
    credentialHint
  ]
    .filter(Boolean)
    .join(', ')
  const statusColor = isError
    ? colors.danger
    : credentialUnavailable
      ? colors.warning
      : colors.textSecondary

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={400}
      pressedScale={0.985}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: radius.lg,
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        paddingLeft: space.md,
        paddingRight: space.xs,
        paddingVertical: space.md
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: connected ? colors.accentSoft : colors.bgRaised,
          marginRight: space.md
        }}
      >
        <Monitor
          size={20}
          color={connected ? colors.accentText : colors.textSecondary}
          strokeWidth={2}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="body" weight="semibold" tone={connected ? 'primary' : 'secondary'} numberOfLines={1}>
          {props.host.name}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <StatusDot state={props.state} verdict={statusVerdict} gap={false} size={7} />
          <Txt variant="caption" numberOfLines={1} style={{ flex: 1, color: statusColor }}>
            {statusLabel}
            {connectionPathLabel ? ` · ${connectionPathLabel}` : ''}
          </Txt>
        </View>
        {connected && worktreeSummary ? (
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {worktreeSummary}
          </Txt>
        ) : null}
        {discoveryHint || credentialHint ? (
          <Txt variant="caption" tone="muted" numberOfLines={2}>
            {discoveryHint ?? credentialHint}
          </Txt>
        ) : null}
      </View>
      <IconButton
        icon={MoreHorizontal}
        accessibilityLabel={`Actions for ${props.host.name}`}
        onPress={props.onOpenActions}
        size={40}
        iconSize={18}
      />
      <ChevronRight size={16} color={colors.textMuted} style={{ marginRight: space.xs }} />
    </PressScale>
  )
}
