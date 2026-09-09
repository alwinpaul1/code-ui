import type { SleepingAgentLaunchConfig } from '../../../src/shared/agent-session-resume'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../src/shared/tui-agent-launch-defaults'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import type { RpcClient } from '../transport/rpc-client'
import { buildAgentHudLaunchArgs } from './agent-hud-launch-args'

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
 * limits to its PTY on the invisible HUD beacon. Null when there is nothing to
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
  const agentArgs = buildAgentHudLaunchArgs({
    agent,
    hostDefaultArgs: resolveTuiAgentLaunchArgs(agent, hostSettings.agentDefaultArgs),
    // Codex's notify command differs on Windows: Git for Windows puts no
    // sh.exe on PATH, and Codex spawns notify with no shell.
    hostPlatform: readMobileRuntimeHostPlatform(resultOf(status))
  })
  if (agentArgs === null) {
    return null
  }
  return { agentArgs, agentEnv: resolveTuiAgentLaunchEnv(agent, hostSettings.agentDefaultEnv) }
}
