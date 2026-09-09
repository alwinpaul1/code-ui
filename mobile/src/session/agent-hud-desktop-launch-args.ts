import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { RpcClient } from '../transport/rpc-client'

/**
 * Cleanup for a short-lived 0.2.77 experiment that wrote status-line launch
 * flags into Orca's per-agent `agentDefaultArgs`. Those flags put a line in
 * the user's own terminals, which Code UI must never do, so every connect now
 * removes exactly our flags if a host still carries them. The user's own
 * arguments are left untouched. This module can go once no host is on 0.2.77.
 */
const HUD_AGENTS = ['claude', 'codex'] as const
type HudAgent = (typeof HUD_AGENTS)[number]

const MARKERS: Record<HudAgent, RegExp> = {
  claude: /\s*--settings '\{"statusLine":\{"type":"command","command":"[^']*'/,
  codex: /\s*-c 'tui\.status_line=\[[^']*\]'/
}

export function withoutAgentHudDesktopFlag(agent: HudAgent, current: string | undefined): string {
  return (current ?? '').replace(MARKERS[agent], '').trim()
}

type HostSettingsLike = { agentDefaultArgs?: Partial<Record<TuiAgent, string>> }

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as { ok?: boolean; result?: unknown } | null
  return envelope?.ok === true && envelope.result && typeof envelope.result === 'object'
    ? (envelope.result as Record<string, unknown>)
    : null
}

/** Strip our flags from the host's launch profile; writes only if any were found. */
export async function syncAgentHudDesktopLaunchArgs(
  client: RpcClient,
  _enabled: false
): Promise<Partial<Record<TuiAgent, string>> | null> {
  const settings = resultOf(await client.sendRequest('settings.get').catch(() => null))
  if (!settings) {
    return null
  }
  const current = ((settings as HostSettingsLike).agentDefaultArgs ?? {}) as Partial<
    Record<TuiAgent, string>
  >
  const next: Partial<Record<TuiAgent, string>> = { ...current }
  let changed = false
  for (const agent of HUD_AGENTS) {
    const value = withoutAgentHudDesktopFlag(agent, current[agent])
    if (value !== (current[agent] ?? '')) {
      changed = true
      if (value) {
        next[agent] = value
      } else {
        delete next[agent]
      }
    }
  }
  if (!changed) {
    return null
  }
  const response = await client
    .sendRequest('settings.update', { agentDefaultArgs: next })
    .catch(() => null)
  return resultOf(response) ? next : null
}
