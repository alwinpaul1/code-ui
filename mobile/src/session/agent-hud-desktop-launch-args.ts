import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { RpcClient } from '../transport/rpc-client'
import {
  buildClaudeHudSettingsJson,
  buildCodexHudConfigOverride
} from './agent-hud-launch-args'

/**
 * Agents started on the DESKTOP get their status line the same way the
 * phone's own launches do, through Orca's per-agent default arguments
 * (`agentDefaultArgs`), which Orca appends to every agent it launches. Orca
 * manages that field itself (its yolo mode writes it too) and lets a paired
 * phone update it over `settings.update`. So the phone adds two flags there
 * once, and removes them again when the switch is turned off. Nothing else on
 * the host is touched: no file of the user's, no plugin, no script.
 *
 * The user's own arguments are preserved in front; ours are recognised by
 * their exact text, so the write is idempotent and the removal surgical.
 */
const HUD_AGENTS = ['claude', 'codex'] as const
type HudAgent = (typeof HUD_AGENTS)[number]

function singleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function agentHudDesktopFlag(agent: HudAgent): string {
  return agent === 'claude'
    ? `--settings ${singleQuoted(buildClaudeHudSettingsJson())}`
    : `-c ${singleQuoted(buildCodexHudConfigOverride())}`
}

/** Marker that identifies an earlier version of our flag, so an upgrade
 *  replaces it instead of stacking a second one. */
const MARKERS: Record<HudAgent, RegExp> = {
  claude: /\s*--settings '\{"statusLine":\{"type":"command","command":"[^']*'/,
  codex: /\s*-c 'tui\.status_line=\[[^']*\]'/
}

export function withAgentHudDesktopFlag(agent: HudAgent, current: string | undefined): string {
  const base = (current ?? '').replace(MARKERS[agent], '').trim()
  const flag = agentHudDesktopFlag(agent)
  return base ? `${base} ${flag}` : flag
}

export function withoutAgentHudDesktopFlag(agent: HudAgent, current: string | undefined): string {
  return (current ?? '').replace(MARKERS[agent], '').trim()
}

export function hasAgentHudDesktopFlag(agent: HudAgent, current: string | undefined): boolean {
  return (current ?? '').includes(agentHudDesktopFlag(agent))
}

type HostSettingsLike = { agentDefaultArgs?: Partial<Record<TuiAgent, string>> }

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as { ok?: boolean; result?: unknown } | null
  return envelope?.ok === true && envelope.result && typeof envelope.result === 'object'
    ? (envelope.result as Record<string, unknown>)
    : null
}

/**
 * Bring the host's launch profile in line with the switch. Reads the current
 * profile first and writes only when something changes, so a reconnect costs
 * one `settings.get` and nothing else. Returns what was written, or null.
 */
export async function syncAgentHudDesktopLaunchArgs(
  client: RpcClient,
  enabled: boolean
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
    const value = enabled
      ? withAgentHudDesktopFlag(agent, current[agent])
      : withoutAgentHudDesktopFlag(agent, current[agent])
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
