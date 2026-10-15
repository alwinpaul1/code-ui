import type { SleepingAgentLaunchConfig } from '../../../src/shared/agent-session-resume'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../src/shared/tui-agent-launch-defaults'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import type { RpcClient } from '../transport/rpc-client'
import { withoutStaleWindowsHudFlag } from './agent-hud-desktop-launch-args'
import { buildAgentHudLaunchArgs } from './agent-hud-launch-args'
import { withRemoteControlFlag } from './agent-remote-control-launch-args'
import { withClaudeAutoPermissionMode } from './claude-auto-permission-mode'
import { loadRemoteControlNewSessions } from '../storage/remote-control-preference'

type HostLaunchSettings = {
  agentDefaultArgs?: Partial<Record<TuiAgent, string>>
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>>
}

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as { ok?: boolean; result?: unknown } | null
  return envelope?.ok === true && envelope.result && typeof envelope.result === 'object'
    ? (envelope.result as Record<string, unknown>)
    : null
}

/**
 * The launch config for an agent tab the phone opens: the host's own default
 * args and env for that agent (exactly what the desktop would launch with),
 * plus the flags that make the agent write its model, effort, context and
 * limits to its PTY on the invisible HUD beacon, and, for Claude, the flag that
 * starts it in auto permission mode. Null when there is nothing to
 * add, so the host launches exactly as it always did.
 */
export async function resolveAgentHudLaunchConfig(
  client: RpcClient,
  agent: TuiAgent
): Promise<SleepingAgentLaunchConfig | null> {
  const [settings, status] = await Promise.all([
    client.sendRequest('settings.get').catch(() => null),
    client.sendRequest('status.get').catch(() => null)
  ])
  const hostSettings = (resultOf(settings) ?? {}) as HostLaunchSettings
  const hostDefaultArgs = resolveTuiAgentLaunchArgs(agent, hostSettings.agentDefaultArgs)
  const hostPlatform = readMobileRuntimeHostPlatform(resultOf(status))
  // A Windows host takes no flag (`hostTakesAgentHudFlag`), so it launches as
  // the desktop would, less any flag an earlier build saved in its profile.
  const hudArgs =
    buildAgentHudLaunchArgs({ agent, hostDefaultArgs, hostPlatform }) ??
    withoutStaleWindowsHudFlag(agent, hostDefaultArgs, hostPlatform)
  // Every Claude session the phone starts starts in auto mode, over any
  // permission flag the host saved (Orca's own default is bypass).
  const autoArgs = withClaudeAutoPermissionMode({ agent, agentArgs: hudArgs, hostPlatform })
  // Remote Control for a new Claude tab, unless the Settings switch is off.
  // After the permission flag, so it always has a flag to stand in front of.
  const agentArgs = withRemoteControlFlag({
    agent,
    agentArgs: autoArgs,
    hostPlatform,
    enabled: agent === 'claude' ? await loadRemoteControlNewSessions() : false
  })
  if (agentArgs === hostDefaultArgs) {
    return null
  }
  return { agentArgs, agentEnv: resolveTuiAgentLaunchEnv(agent, hostSettings.agentDefaultEnv) }
}
